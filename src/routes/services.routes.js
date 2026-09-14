const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/services — any authenticated user (needed for the Lead
// dropdowns). ?includeInactive=1 for the Manage Services admin screen
// only - everywhere else should only ever see active ones.
router.get('/', requireAuth, async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const services = await prisma.serviceOption.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { order: 'asc' },
  });
  res.json(services);
});

// POST /api/services — Admin/Super Admin only. Adds a new service to
// the end of the list.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter a service name.' });
  const existing = await prisma.serviceOption.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'That service is already in the list.' });
  const maxOrder = await prisma.serviceOption.aggregate({ _max: { order: true } });
  const service = await prisma.serviceOption.create({
    data: { name: name.trim(), order: (maxOrder._max.order || 0) + 1 },
  });
  res.status(201).json(service);
});

// PATCH /api/services/:id — Admin/Super Admin only. Used for both
// retiring/reactivating (active: true/false) and renaming.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { active, name } = req.body;
  const data = {};
  if (typeof active === 'boolean') data.active = active;
  if (typeof name === 'string' && name.trim()) data.name = name.trim();
  const service = await prisma.serviceOption.update({ where: { id: req.params.id }, data });
  res.json(service);
});

// DELETE /api/services/:id — Admin/Super Admin only. A real, permanent
// delete - Lead.service is a plain string, not a foreign key, so
// existing records simply keep whatever string they already have.
// This only removes the option from the dropdown for future use.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.serviceOption.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
