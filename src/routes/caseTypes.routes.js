const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/case-types — any authenticated user (needed for the Task
// dropdowns in both Admin and Employee). ?includeInactive=1 for the
// Manage Case Types admin screen only.
router.get('/', requireAuth, async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const caseTypes = await prisma.caseTypeOption.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { order: 'asc' },
  });
  res.json(caseTypes);
});

// POST /api/case-types — Admin/Super Admin only.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter a case type name.' });
  const existing = await prisma.caseTypeOption.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'That case type is already in the list.' });
  const maxOrder = await prisma.caseTypeOption.aggregate({ _max: { order: true } });
  const caseType = await prisma.caseTypeOption.create({
    data: { name: name.trim(), order: (maxOrder._max.order || 0) + 1 },
  });
  res.status(201).json(caseType);
});

// PATCH /api/case-types/:id — Admin/Super Admin only.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { active, name } = req.body;
  const data = {};
  if (typeof active === 'boolean') data.active = active;
  if (typeof name === 'string' && name.trim()) data.name = name.trim();
  const caseType = await prisma.caseTypeOption.update({ where: { id: req.params.id }, data });
  res.json(caseType);
});

// DELETE /api/case-types/:id — Admin/Super Admin only. A real,
// permanent delete - Task.caseType is a plain string, not a foreign
// key, so existing tasks simply keep whatever string they already have.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.caseTypeOption.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
