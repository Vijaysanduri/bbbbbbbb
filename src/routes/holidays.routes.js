const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/holidays?year=2026 — anyone signed in can view.
router.get('/', requireAuth, async (req, res) => {
  const { year } = req.query;
  const where = year
    ? { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31T23:59:59`) } }
    : {};
  const holidays = await prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  res.json(holidays);
});

// POST /api/holidays — Admin/HR/Super Admin only.
// Body: { date, name }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'date and name are required.' });
  const holiday = await prisma.holiday.create({
    data: { date: new Date(date), name, createdById: req.user.id },
  });
  res.status(201).json(holiday);
});

// DELETE /api/holidays/:id — Admin/HR/Super Admin only.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const holiday = await prisma.holiday.findUnique({ where: { id: req.params.id } });
  if (!holiday) return res.status(404).json({ error: 'Holiday not found.' });
  await prisma.holiday.delete({ where: { id: holiday.id } });
  res.json({ success: true });
});

module.exports = router;
