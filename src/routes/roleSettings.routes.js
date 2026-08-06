const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/role-settings — any authenticated user can read this (needed
// so the frontend can show/hide things appropriately for HR users too).
router.get('/', requireAuth, async (req, res) => {
  const settings = await prisma.roleCapabilitySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  res.json(settings);
});

// PATCH /api/role-settings — Admin/Super Admin only.
// Body: any subset of { hrSeesPayroll, hrSeesResignations, hrSeesEmployee360, hrSeesExpenseFinancials, hrSeesConfidentialDocuments }
router.patch('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { hrSeesPayroll, hrSeesResignations, hrSeesEmployee360, hrSeesExpenseFinancials, hrSeesConfidentialDocuments } = req.body;
  const data = {};
  if (hrSeesPayroll !== undefined) data.hrSeesPayroll = !!hrSeesPayroll;
  if (hrSeesResignations !== undefined) data.hrSeesResignations = !!hrSeesResignations;
  if (hrSeesEmployee360 !== undefined) data.hrSeesEmployee360 = !!hrSeesEmployee360;
  if (hrSeesExpenseFinancials !== undefined) data.hrSeesExpenseFinancials = !!hrSeesExpenseFinancials;
  if (hrSeesConfidentialDocuments !== undefined) data.hrSeesConfidentialDocuments = !!hrSeesConfidentialDocuments;

  const settings = await prisma.roleCapabilitySettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });
  const changed = Object.entries(data).map(([k, v]) => k + ': ' + (v ? 'ON' : 'OFF'));
  if (changed.length) await logActivity(`HR capability settings changed — ${changed.join(', ')}.`, req.user.id);
  res.json(settings);
});

module.exports = router;
