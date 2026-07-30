const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  await prisma.activityLog.create({ data: { text, actorId } });
}

// GET /api/leaves — Admin/Super Admin only. Every leave request, any employee.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const leaves = await prisma.leaveRequest.findMany({
    include: { user: { select: { fullName: true } } },
    orderBy: { appliedAt: 'desc' },
  });
  res.json(leaves);
});

// PATCH /api/leaves/:id/decide — Admin/Super Admin only.
// Body: { status: 'APPROVED'|'REJECTED' }
router.patch('/:id/decide', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { status } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
  const updated = await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status, decidedAt: new Date() } });
  await sendMail({
    to: leave.user.email,
    subject: `Your leave request has been ${status.toLowerCase()}`,
    body: `Hi ${leave.user.fullName},\n\nYour ${leave.leaveType.toLowerCase()} leave request (${leave.fromDate.toISOString().slice(0,10)} to ${leave.toDate.toISOString().slice(0,10)}) has been ${status.toLowerCase()}.\n\nBest,\nDream2Fly HR`,
  });
  res.json(updated);
});

// GET /api/leaves/me — my leave requests
router.get('/me', requireAuth, async (req, res) => {
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: req.user.id },
    orderBy: { appliedAt: 'desc' },
  });
  res.json(leaves);
});

// POST /api/leaves — apply for leave
// Body: { leaveType, fromDate, toDate, reason }
router.post('/', requireAuth, async (req, res) => {
  const { leaveType, fromDate, toDate, reason } = req.body;
  if (!fromDate || !toDate || !reason) {
    return res.status(400).json({ error: 'fromDate, toDate and reason are required.' });
  }
  const leave = await prisma.leaveRequest.create({
    data: {
      userId: req.user.id,
      leaveType: leaveType || 'CASUAL',
      fromDate: new Date(fromDate),
      toDate: new Date(toDate),
      reason,
    },
  });
  await logActivity(`${req.user.fullName} applied for ${leave.leaveType.toLowerCase()} leave (${fromDate} to ${toDate}).`, req.user.id);
  res.status(201).json(leave);
});

// POST /api/leaves/:id/cancel — cancel a pending leave request
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!leave || leave.userId !== req.user.id) {
    return res.status(404).json({ error: 'Leave request not found.' });
  }
  if (leave.status !== 'PENDING') {
    return res.status(400).json({ error: 'Only pending leave requests can be cancelled.' });
  }
  const updated = await prisma.leaveRequest.update({
    where: { id: leave.id },
    data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  res.json(updated);
});

module.exports = router;
