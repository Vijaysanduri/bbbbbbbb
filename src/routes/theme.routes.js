const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/theme — deliberately public, no auth. The logged-out public
// website and login page need these colors before anyone signs in, so
// this can't require a token the way most of the API does.
router.get('/', async (req, res) => {
  let theme = await prisma.siteTheme.findUnique({ where: { id: 'singleton' } });
  if (!theme) {
    // First-ever request: create the row with defaults so every future
    // read is a simple lookup, not a "does it exist yet" check.
    theme = await prisma.siteTheme.create({ data: { id: 'singleton' } });
  }
  res.json({ primaryColor: theme.primaryColor, accentColor: theme.accentColor, dangerColor: theme.dangerColor });
});

// PATCH /api/theme — Admin/Super Admin only. Upserts the single theme
// row — creates it on the very first change if GET was never called
// first for some reason.
router.patch('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { primaryColor, accentColor, dangerColor } = req.body;
  const hexPattern = /^#[0-9a-fA-F]{6}$/;
  for (const [label, value] of [['primaryColor', primaryColor], ['accentColor', accentColor], ['dangerColor', dangerColor]]) {
    if (value !== undefined && !hexPattern.test(value)) {
      return res.status(400).json({ error: `${label} must be a valid hex color like #0b1f4d.` });
    }
  }
  const theme = await prisma.siteTheme.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', primaryColor, accentColor, dangerColor, updatedById: req.user.id },
    update: { ...(primaryColor ? { primaryColor } : {}), ...(accentColor ? { accentColor } : {}), ...(dangerColor ? { dangerColor } : {}), updatedById: req.user.id },
  });
  res.json({ primaryColor: theme.primaryColor, accentColor: theme.accentColor, dangerColor: theme.dangerColor });
});

module.exports = router;
