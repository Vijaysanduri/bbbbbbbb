const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { createRazorpayOrder, verifyPaymentSignature, isConfigured } = require('../utils/razorpay');
const { rateLimiter } = require('../middleware/rateLimiter');
const { notifyRecordWatchers } = require('../utils/notifications');

const router = express.Router();
const prisma = new PrismaClient();

const verifyRateLimit = rateLimiter({ maxAttempts: 15, windowMs: 15 * 60 * 1000, message: 'Too many attempts. Please wait a few minutes and try again.' });

// Payments aren't tied to a task directly (a payment belongs to a student,
// not a case) — so to surface it where staff actually look (the task's
// comment thread, the assigned employee's notification bell), this looks
// up whichever task that student is linked to and posts there. If the
// student isn't linked to any task yet, this quietly does nothing rather
// than erroring — the payment itself is unaffected either way.
async function notifyAndLogPaymentEvent(studentId, text, actorId) {
  try {
    const task = await prisma.task.findFirst({ where: { studentId } });
    if (!task) return;
    await prisma.comment.create({ data: { taskId: task.id, isSystem: true, text } });
    await notifyRecordWatchers({
      assignedEmployeeId: task.assignedEmployeeId,
      actorId: actorId || null,
      title: `Payment update — ${task.related}`,
      body: text,
      type: 'TASK_COMMENT',
      link: 'tasks',
    });
  } catch (err) {
    console.error('[notifyAndLogPaymentEvent] failed:', err.message);
  }
}

// GET /api/payments/razorpay-status — anyone signed in. Lets the
// frontend show "payments not yet configured" instead of a broken
// checkout button if the keys aren't set up yet.
router.get('/razorpay-status', requireAuth, async (req, res) => {
  res.json({ configured: isConfigured(), keyId: isConfigured() ? process.env.RAZORPAY_KEY_ID : null });
});

// POST /api/payments/request — Admin/Super Admin/Employee/Counsellor/Manager only.
// Body: { studentEmail, purpose, amount }
router.post('/request', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { studentEmail, purpose, amount } = req.body;
  if (!studentEmail || !purpose || !amount) return res.status(400).json({ error: 'studentEmail, purpose and amount are required.' });
  const student = await prisma.user.findFirst({ where: { email: studentEmail, role: 'STUDENT' } });
  if (!student) return res.status(404).json({ error: 'No student account found with that email.' });

  const payment = await prisma.payment.create({
    data: { studentId: student.id, purpose, amount: parseFloat(amount), requestedById: req.user.id },
  });

  await sendMail({
    to: student.email,
    subject: `Payment due: ${purpose}`,
    body: `Hi ${student.fullName},\n\nA payment of ₹${payment.amount.toFixed(2)} is due for "${purpose}". Please log in to your student portal to complete this via Razorpay.\n\nBest,\nDream2Fly`,
  });
  notifyAndLogPaymentEvent(student.id, `Payment requested: ₹${payment.amount.toFixed(2)} for "${purpose}" (by ${req.user.fullName}).`, req.user.id)
    .catch(err => console.error('[payments/request] notifyAndLogPaymentEvent failed:', err.message));

  res.status(201).json(payment);
});

// GET /api/payments/me — Student only. Their own payment requests, pending and paid.
router.get('/me', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { studentId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

// POST /api/payments/:id/create-order — Student only. Creates the
// Razorpay Order for a pending payment, ready for the checkout popup.
router.post('/:id/create-order', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.studentId !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
  if (payment.status === 'PAID') return res.status(400).json({ error: 'This has already been paid.' });

  const order = await createRazorpayOrder({
    amountInPaise: Math.round(payment.amount * 100),
    receipt: payment.id,
    notes: { purpose: payment.purpose, studentEmail: req.user.email },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { razorpayOrderId: order.id } });
  res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID || null, simulated: !!order.simulated });
});

// POST /api/payments/:id/verify — Student only. Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
// Verifies the payment genuinely came from Razorpay before marking it paid.
router.post('/:id/verify', requireAuth, requireRole('STUDENT'), verifyRateLimit, async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.studentId !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });

  const valid = verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    return res.status(400).json({ error: 'Payment verification failed — this does not appear to be a genuine Razorpay payment.' });
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'PAID', razorpayPaymentId, razorpaySignature, paidAt: new Date() },
    include: { student: true, requestedBy: true },
  });

  // Alert the student and whoever requested the payment. Amount and
  // purpose are pulled straight from this payment record — never
  // hardcoded — so the confirmation always matches whatever was actually
  // requested and paid, however that payment was initiated.
  await sendMail({
    to: updated.student.email,
    subject: `Payment confirmed: ${updated.purpose} — ₹${updated.amount.toFixed(2)}`,
    body: `Hi ${updated.student.fullName},\n\nThis confirms we've received your payment.\n\nAmount Paid: ₹${updated.amount.toFixed(2)}\nPurpose: ${updated.purpose}\nDate: ${new Date().toLocaleDateString('en-GB')}\nReference: ${updated.id}\n\nThank you!\n\nBest,\nDream2Fly`,
  });
  if (updated.requestedBy) {
    await sendMail({
      to: updated.requestedBy.email,
      subject: `Payment received from ${updated.student.fullName}`,
      body: `${updated.student.fullName} has paid ₹${updated.amount.toFixed(2)} for "${updated.purpose}".`,
    });
  }
  notifyAndLogPaymentEvent(updated.studentId, `Payment received: ₹${updated.amount.toFixed(2)} for "${updated.purpose}" — paid successfully.`, null)
    .catch(err => console.error('[payments/verify] notifyAndLogPaymentEvent failed:', err.message));

  res.json(updated);
});

// GET /api/payments — Admin/Super Admin/Employee/Counsellor/Manager only.
// Every payment request across every student.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const payments = await prisma.payment.findMany({
    include: { student: { select: { fullName: true, email: true } }, requestedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

module.exports = router;
