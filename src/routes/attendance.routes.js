const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// GET /api/attendance/all?date=YYYY-MM-DD — Admin/Super Admin only.
router.get('/all', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  // Supports both the original single-date query (still the default,
  // for backward compatibility) and a proper date range via from/to,
  // plus an optional employeeId filter — this used to only ever show
  // one day at a time with no way to filter to a specific person or
  // see a real range.
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00.000Z') : new Date(dateStr + 'T00:00:00.000Z');
  const to = req.query.to ? new Date(req.query.to + 'T23:59:59.999Z') : new Date(dateStr + 'T23:59:59.999Z');
  const employeeId = req.query.employeeId || undefined;
  const records = await prisma.attendance.findMany({
    where: { date: { gte: from, lte: to }, ...(employeeId ? { userId: employeeId } : {}) },
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

  // Notify the employee, their reporting manager, and HR that attendance was
  // recorded today. Kept to a single email at clock-in (not clock-out too)
  // to avoid doubling up — worth reviewing if this turns out to be too much
  // daily volume for managers with large teams.
  const employee = await prisma.user.findUnique({ where: { id: req.user.id }, include: { reportingManager: true } });
  const hrUsers = await prisma.user.findMany({ where: { role: 'HR', active: true } });
  const recipients = [employee, employee.reportingManager, ...hrUsers].filter(Boolean);
  const seenEmails = new Set();
  const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  for (const person of recipients) {
    if (seenEmails.has(person.email)) continue;
    seenEmails.add(person.email);
    const isSelf = person.id === employee.id;
    await sendMail({
      to: person.email,
      subject: isSelf ? `You've clocked in — ${timeStr}` : `${employee.fullName} clocked in — ${timeStr}`,
      body: isSelf
        ? `Hi ${person.fullName},\n\nYou clocked in today at ${timeStr}.\n\nBest,\nDream2Fly`
        : `Hi ${person.fullName},\n\n${employee.fullName} clocked in today at ${timeStr}.\n\nBest,\nDream2Fly`,
    });
  }

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

// GET /api/attendance/calendar?month=YYYY-MM — the signed-in user's own
// calendar for that month: every day marked as a holiday, week-off
// (Sundays — the one fixed weekly-off day this keeps simple; a
// configurable pattern would be a further enhancement), approved leave,
// actual attendance status, or absent/blank. This is what powers the
// month-view calendar on the Employee dashboard.
router.get('/calendar', requireAuth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
  const daysInMonth = monthEnd.getUTCDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const attendanceRows = await prisma.attendance.findMany({
    where: { userId: req.user.id, date: { gte: monthStart, lte: monthEnd } },
  });
  const holidayRows = await prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } } });
  const leaveRows = await prisma.leaveRequest.findMany({
    where: { userId: req.user.id, status: 'APPROVED', fromDate: { lte: monthEnd }, toDate: { gte: monthStart } },
  });

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, mon - 1, d));
    const dateStr = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getUTCDay();
    const isWeekOff = dayOfWeek === 0; // Sunday
    const holiday = holidayRows.find(h => h.date.toISOString().slice(0, 10) === dateStr);
    const attendance = attendanceRows.find(a => a.date.toISOString().slice(0, 10) === dateStr);
    const onLeave = leaveRows.some(l => new Date(l.fromDate) <= date && new Date(l.toDate) >= date);

    let status;
    if (holiday) status = 'HOLIDAY';
    else if (isWeekOff) status = 'WEEK_OFF';
    else if (onLeave) status = 'ON_LEAVE';
    else if (attendance) status = attendance.status;
    else if (dateStr < todayStr) status = 'ABSENT';
    else status = null; // today/future, no data yet

    days.push({ date: dateStr, dayOfWeek, status, holidayName: holiday ? holiday.name : null });
  }

  res.json({ month, days });
});

module.exports = router;
