const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// GET /api/attendance/all?date=YYYY-MM-DD — Admin/Super Admin only.
router.get('/all', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const dayStart = new Date(dateStr + 'T00:00:00.000Z');
  const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
  const records = await prisma.attendance.findMany({
    where: { date: { gte: dayStart, lte: dayEnd } },
    include: { user: { select: { fullName: true, role: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(records);
});

// ---------------- Attendance ----------------

// GET /api/attendance/me — my attendance history
router.get('/me', requireAuth, async (req, res) => {
  const records = await prisma.attendance.findMany({
    where: { userId: req.user.id },
    orderBy: { date: 'desc' },
    take: 60,
  });
  res.json(records);
});

// POST /api/attendance/clock-in
router.post('/clock-in', requireAuth, async (req, res) => {
  const today = startOfDay(new Date());
  const existing = await prisma.attendance.findFirst({
    where: { userId: req.user.id, date: today },
  });
  if (existing && existing.clockIn) {
    return res.status(400).json({ error: 'You have already clocked in today.' });
  }
  const record = existing
    ? await prisma.attendance.update({ where: { id: existing.id }, data: { clockIn: new Date(), status: 'PRESENT' } })
    : await prisma.attendance.create({ data: { userId: req.user.id, date: today, clockIn: new Date(), status: 'PRESENT' } });
  res.status(201).json(record);
});

// POST /api/attendance/clock-out
router.post('/clock-out', requireAuth, async (req, res) => {
  const today = startOfDay(new Date());
  const existing = await prisma.attendance.findFirst({
    where: { userId: req.user.id, date: today },
  });
  if (!existing || !existing.clockIn) {
    return res.status(400).json({ error: 'You need to clock in before you can clock out.' });
  }
  if (existing.clockOut) {
    return res.status(400).json({ error: 'You have already clocked out today.' });
  }
  const record = await prisma.attendance.update({ where: { id: existing.id }, data: { clockOut: new Date() } });
  res.json(record);
});

module.exports = router;
