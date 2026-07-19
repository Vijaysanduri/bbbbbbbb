const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const DEFAULT_KEYS = ['excelUpload', 'aiAssistant', 'convertToTask', 'followupLogging', 'editPhone', 'resetPassword'];

// GET /api/feature-flags?scope=EMPLOYEE
// Any authenticated user can read the flags that apply to their own role —
// this is what the employee dashboard calls on load instead of localStorage.
router.get('/', requireAuth, async (req, res) => {
  const scope = req.query.scope || req.user.role;
  const rows = await prisma.featureFlag.findMany({ where: { scope } });
  const flags = {};
  DEFAULT_KEYS.forEach(key => { flags[key] = true; }); // default on if not yet set
  rows.forEach(row => { flags[row.key] = row.enabled; });
  res.json(flags);
});

// PUT /api/feature-flags
// Body: { scope: 'EMPLOYEE', flags: { excelUpload: false, ... } }
// Restricted to Admin/Super Admin — this is the real version of the
// "Employee Portal — Feature Controls" panel on the admin dashboard.
router.put('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { scope, flags } = req.body;
  if (!scope || !flags) return res.status(400).json({ error: 'scope and flags are required.' });

  const updates = Object.entries(flags).map(([key, enabled]) =>
    prisma.featureFlag.upsert({
      where: { scope_key: { scope, key } },
      update: { enabled, updatedBy: req.user.id },
      create: { scope, key, enabled, updatedBy: req.user.id }
    })
  );
  await prisma.$transaction(updates);
  res.json({ success: true, scope, flags });
});

module.exports = router;
