const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/countries/public — no auth. For the public website's own
// registration form (dream2fly.co.uk) - same /public naming
// convention already used for leads and career applications. Only
// ever returns active ones; never includeInactive here, since a
// public visitor should never see a retired option.
router.get('/public', async (req, res) => {
  const countries = await prisma.countryOption.findMany({
    where: { active: true },
    orderBy: { order: 'asc' },
    select: { name: true },
  });
  res.json(countries);
});

// GET /api/countries — any authenticated user (needed for dropdowns
// across Admin, Employee, and Partner). ?includeInactive=1 for the
// Manage Countries admin screen only - everywhere else should only
// ever see active ones.
router.get('/', requireAuth, async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const countries = await prisma.countryOption.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { order: 'asc' },
  });
  res.json(countries);
});

// POST /api/countries — Admin/Super Admin only. Adds a new country to
// the end of the list.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter a country name.' });
  const existing = await prisma.countryOption.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'That country is already in the list.' });
  const maxOrder = await prisma.countryOption.aggregate({ _max: { order: true } });
  const country = await prisma.countryOption.create({
    data: { name: name.trim(), order: (maxOrder._max.order || 0) + 1 },
  });
  res.status(201).json(country);
});

// PATCH /api/countries/:id — Admin/Super Admin only. Used for both
// retiring/reactivating (active: true/false) and renaming.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { active, name } = req.body;
  const data = {};
  if (typeof active === 'boolean') data.active = active;
  if (typeof name === 'string' && name.trim()) data.name = name.trim();
  const country = await prisma.countryOption.update({ where: { id: req.params.id }, data });
  res.json(country);
});

// DELETE /api/countries/:id — Admin/Super Admin only. A real, permanent
// delete - Lead.country/Task.country are plain strings, not a foreign
// key, so existing records simply keep whatever string they already
// have. This only removes the option from the dropdown for future use.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.countryOption.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
