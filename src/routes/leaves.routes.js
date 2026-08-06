const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  await prisma.activityLog.create({ data: { text, actorId } });
}

// GET /api/leaves — Admin/Super Admin see everyone's requests. Anyone
// else (a Manager, most commonly) sees only requests from people who
// report directly to them — not the whole company's.
router.get('/', requireAuth, async (req, res) => {
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const leaves = await prisma.leaveRequest.findMany({
    where: isStaff ? {} : { user: { reportingManagerId: req.user.id } },
    include: { user: { select: { fullName: true, reportingManagerId: true } } },
    orderBy: { appliedAt: 'desc' },
  });
  res.json(leaves);
});

// PATCH /api/leaves/:id/decide — Admin/Super Admin can decide on anyone's
// request. Anyone else can only decide on a request from someone who
// actually reports to them — not just any employee's.
router.patch('/:id/decide', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const isTheirManager = leave.user.reportingManagerId === req.user.id;
  if (!isStaff && !isTheirManager) {
    return res.status(403).json({ error: 'You can only decide on leave requests from people who report to you.' });
  }
  const updated = await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status, decidedAt: new Date() } });
  await sendMail({
    to: leave.user.email,
    subject: `Your leave request has been ${status.toLowerCase()}`,
    body: `Hi ${leave.user.fullName},\n\nYour ${leave.leaveType.toLowerCase()} leave request (${leave.fromDate.toISOString().slice(0,10)} to ${leave.toDate.toISOString().slice(0,10)}) has been ${status.toLowerCase()} by ${req.user.fullName}.\n\nBest,\nDream2Fly HR`,
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

  // Notify the employee (confirmation), their reporting manager, and HR —
  // everyone who needs to know a leave request has come in, the moment it's submitted.
  const applicant = await prisma.user.findUnique({ where: { id: req.user.id }, include: { reportingManager: true } });
  const hrUsers = await prisma.user.findMany({ where: { role: 'HR', active: true } });
  const recipients = [applicant, applicant.reportingManager, ...hrUsers].filter(Boolean);
  const seenEmails = new Set();
  for (const person of recipients) {
    if (seenEmails.has(person.email)) continue;
    seenEmails.add(person.email);
    const isApplicant = person.id === applicant.id;
    await sendMail({
      to: person.email,
      subject: isApplicant ? `Your ${leave.leaveType.toLowerCase()} leave request has been submitted` : `${applicant.fullName} has applied for leave`,
      body: isApplicant
        ? `Hi ${person.fullName},\n\nYour ${leave.leaveType.toLowerCase()} leave request (${fromDate} to ${toDate}) has been submitted and is pending approval.\n\nReason: ${reason}\n\nBest,\nDream2Fly HR`
        : `Hi ${person.fullName},\n\n${applicant.fullName} has applied for ${leave.leaveType.toLowerCase()} leave (${fromDate} to ${toDate}).\n\nReason: ${reason}\n\nPlease review in the Admin dashboard under Leave Management.\n\nBest,\nDream2Fly HR`,
    });
  }

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
