const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/admin-settings — Admin/Super Admin only. Returns the two
// editable alert/backup email addresses (null if never set).
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const row = await prisma.adminSetting.findUnique({ where: { id: 'main' } });
  res.json({
    confidentialNotesAlertEmail: row ? row.confidentialNotesAlertEmail : null,
    monthlyBackupEmail: row ? row.monthlyBackupEmail : null,
    lastMonthlyBackupAt: row ? row.lastMonthlyBackupAt : null,
  });
});

// PUT /api/admin-settings — Admin/Super Admin only. Body: either/both of
// confidentialNotesAlertEmail, monthlyBackupEmail — merges with whatever
// is already saved, so one field can be changed without clearing the
// other. Pass an empty string to clear a field (turns alerts/backups off
// for that one without touching the other).
router.put('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { confidentialNotesAlertEmail, monthlyBackupEmail } = req.body;
  const data = {};
  if (confidentialNotesAlertEmail !== undefined) data.confidentialNotesAlertEmail = confidentialNotesAlertEmail || null;
  if (monthlyBackupEmail !== undefined) data.monthlyBackupEmail = monthlyBackupEmail || null;
  const row = await prisma.adminSetting.upsert({
    where: { id: 'main' },
    update: data,
    create: { id: 'main', ...data },
  });
  res.json({
    confidentialNotesAlertEmail: row.confidentialNotesAlertEmail,
    monthlyBackupEmail: row.monthlyBackupEmail,
    lastMonthlyBackupAt: row.lastMonthlyBackupAt,
  });
});

module.exports = router;
