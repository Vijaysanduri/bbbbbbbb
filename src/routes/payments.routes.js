const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { createRazorpayOrder, verifyPaymentSignature, isConfigured } = require('../utils/razorpay');
const { generatePaymentReceiptPdf } = require('../utils/paymentReceiptPdf');
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
    body: `Hi ${student.fullName},\n\nA payment of ₹${payment.amount.toFixed(2)} is due for "${purpose}". Please log in to your student portal to complete this via Razorpay.\n\nPlease note: this payment is non-refundable once processed, in accordance with Dream2Fly's company policy.\n\nBest,\nDream2Fly\n\n© ${new Date().getFullYear()} Dream2Fly Consulting Services Ltd. All rights reserved.`,
  });
  notifyAndLogPaymentEvent(student.id, `Payment requested: ₹${payment.amount.toFixed(2)} for "${purpose}" (by ${req.user.fullName}).`, req.user.id)
    .catch(err => console.error('[payments/request] notifyAndLogPaymentEvent failed:', err.message));

  res.status(201).json(payment);
});

// GET /api/payments/me — Student only. Their own payment requests, pending and paid.
router.get('/me', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { studentId: req.user.id },
    select: {
      id: true, purpose: true, amount: true, status: true, createdAt: true, paidAt: true,
      receiptNumber: true, razorpayOrderId: true, razorpayPaymentId: true,
    },
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

  // Generate the receipt now, once, at the moment of payment success —
  // both the human-readable number and the PDF itself are permanent from
  // here on, stored on the row so "View Receipt" later never regenerates
  // (and potentially drifts) from data that might change afterward.
  let receiptNumber = null;
  try {
    const year = new Date().getFullYear();
    const countThisYear = await prisma.payment.count({ where: { receiptNumber: { startsWith: `D2F-${year}-` } } });
    receiptNumber = `D2F-${year}-${String(countThisYear + 1).padStart(6, '0')}`;
    const receiptPdfBuffer = await generatePaymentReceiptPdf({
      receiptNumber,
      studentName: updated.student.fullName,
      studentEmail: updated.student.email,
      purpose: updated.purpose,
      amount: updated.amount,
      paidAt: updated.paidAt,
      paymentId: updated.razorpayPaymentId,
      requestedByName: updated.requestedBy ? updated.requestedBy.fullName : null,
      remarks: updated.remarks,
    });
    const receiptPdfBase64 = receiptPdfBuffer.toString('base64');
    await prisma.payment.update({ where: { id: updated.id }, data: { receiptNumber, receiptPdf: receiptPdfBase64 } });
    updated.receiptNumber = receiptNumber;

    const receiptAttachment = { attachmentFileName: `Receipt-${receiptNumber}.pdf`, attachmentBase64: receiptPdfBase64 };

    // Alert the student and whoever requested the payment. Amount and
    // purpose are pulled straight from this payment record — never
    // hardcoded — so the confirmation always matches whatever was actually
    // requested and paid, however that payment was initiated.
    await sendMail({
      to: updated.student.email,
      subject: `Payment confirmed: ${updated.purpose} — ₹${updated.amount.toFixed(2)}`,
      body: `Hi ${updated.student.fullName},\n\nThis confirms we've received your payment. Your receipt is attached.\n\nReceipt No: ${receiptNumber}\nAmount Paid: ₹${updated.amount.toFixed(2)}\nPurpose: ${updated.purpose}\nDate: ${new Date().toLocaleDateString('en-GB')}\n\nThank you!\n\nThis payment is non-refundable once processed, in accordance with Dream2Fly's company policy.\n\nBest,\nDream2Fly\n\n© ${new Date().getFullYear()} Dream2Fly Consulting Services Ltd. All rights reserved.`,
      ...receiptAttachment,
    });
    if (updated.requestedBy) {
      await sendMail({
        to: updated.requestedBy.email,
        subject: `Payment received from ${updated.student.fullName} — ${receiptNumber}`,
        body: `${updated.student.fullName} has paid ₹${updated.amount.toFixed(2)} for "${updated.purpose}". Receipt attached.`,
        ...receiptAttachment,
      });
    }
    // Company-wide copy — every active Admin/Super Admin, not a single
    // hardcoded inbox, so this doesn't silently stop reaching anyone if
    // one person's mailbox changes. Matches the pattern already used for
    // new-lead alerts (notifyLeadershipOfNewLead).
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true }, select: { email: true } });
    for (const admin of admins) {
      if (updated.requestedBy && admin.email === updated.requestedBy.email) continue; // already sent above
      await sendMail({
        to: admin.email,
        subject: `Payment received — ${receiptNumber}`,
        body: `${updated.student.fullName} paid ₹${updated.amount.toFixed(2)} for "${updated.purpose}". Receipt attached.`,
        ...receiptAttachment,
      });
    }
  } catch (err) {
    // A receipt/email hiccup should never undo a payment that genuinely
    // succeeded and was already verified against Razorpay above — log it
    // and move on; staff can still see the payment as PAID and re-check
    // manually if a receipt looks like it's missing.
    console.error('[payments/verify] Receipt generation/email failed:', err.message);
  }

  notifyAndLogPaymentEvent(updated.studentId, `Payment received: ₹${updated.amount.toFixed(2)} for "${updated.purpose}" — paid successfully. Receipt: ${receiptNumber || 'pending'}.`, null)
    .catch(err => console.error('[payments/verify] notifyAndLogPaymentEvent failed:', err.message));

  res.json(updated);
});

// GET /api/payments — Admin/Super Admin/Employee/Counsellor/Manager only.
// Every payment request across every student.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  // Admin/Super Admin see every payment company-wide, same as every
  // other list in the app. Employee/Counsellor/Manager only see payments
  // for students whose linked task is actually assigned to them — this
  // was previously missing entirely, meaning any staff member could see
  // every candidate's payment history regardless of who it belonged to.
  const isLeadership = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const where = isLeadership ? {} : {
    student: { is: { ownTasks: { some: { assignedEmployeeId: req.user.id } } } },
  };
  // Deliberately NOT selecting receiptPdf here — that's a multi-KB base64
  // blob per row, and this list can grow to hundreds/thousands of
  // payments over time. Loading every receipt's PDF just to show a table
  // row would get slow fast. The frontend only needs receiptNumber to
  // know a receipt exists; the actual PDF is fetched separately, only
  // for the one payment someone actually clicks to view/download.
  const payments = await prisma.payment.findMany({
    where,
    select: {
      id: true, purpose: true, amount: true, status: true, createdAt: true, paidAt: true,
      receiptNumber: true, remarks: true, remarksUpdatedAt: true,
      razorpayPaymentId: true,
      student: { select: { fullName: true, email: true } },
      requestedBy: { select: { fullName: true } },
      remarksUpdatedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

// GET /api/payments/:id/receipt — returns the stored PDF receipt as a raw
// download. Available to staff (to pull it up for a student who lost
// theirs) and to the student themselves for their own payment only.
router.get('/:id/receipt', requireAuth, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const isLeadership = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const staffRoles = ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'];
  const isOwner = req.user.id === payment.studentId;
  let isAssignedStaff = false;
  if (!isLeadership && staffRoles.includes(req.user.role)) {
    const assignedTask = await prisma.task.findFirst({ where: { studentId: payment.studentId, assignedEmployeeId: req.user.id } });
    isAssignedStaff = !!assignedTask;
  }
  if (!isOwner && !isLeadership && !isAssignedStaff) {
    return res.status(403).json({ error: 'You do not have permission to view this receipt.' });
  }
  if (!payment.receiptPdf) return res.status(404).json({ error: 'No receipt available for this payment — it may not have completed successfully yet.' });
  const buffer = Buffer.from(payment.receiptPdf, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Receipt-${payment.receiptNumber || payment.id}.pdf"`);
  res.send(buffer);
});

// PATCH /api/payments/:id/remarks — Admin/Super Admin/Employee/Counsellor/
// Manager only. Internal notes, never shown to the student — freely
// editable as the situation develops (e.g. a partial refund noted after
// the fact), so this fully overwrites rather than appending, matching how
// the rest of the "overwrite as things change" fields in this app work
// (task overview, interview notes) rather than an unbounded comment log.
router.patch('/:id/remarks', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { remarks } = req.body;
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const updated = await prisma.payment.update({
    where: { id: req.params.id },
    data: { remarks: remarks || null, remarksUpdatedById: req.user.id, remarksUpdatedAt: new Date() },
    include: { remarksUpdatedBy: { select: { fullName: true } } },
  });
  res.json(updated);
});

// Everything below this line is new, purely additive functionality —
// manual status control, an alternate-payment-number workflow for when
// a student pays to a different company PhonePe/UPI number than usual,
// and a unified comments/history timeline. None of the existing
// Razorpay request/pay/verify flow above is touched.

const PAYMENT_STATUS_VALUES = ['PENDING', 'PAID', 'FAILED', 'NOT_REQUIRED', 'CANCELLED'];

// Shared access check used by every new endpoint below — same rule as
// the rest of payments.routes.js: leadership sees/touches everything,
// Employee/Counsellor/Manager only their own assigned students' payments.
async function canAccessPayment(req, payment) {
  if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) return true;
  if (!['EMPLOYEE', 'COUNSELLOR', 'MANAGER'].includes(req.user.role)) return false;
  const assignedTask = await prisma.task.findFirst({ where: { studentId: payment.studentId, assignedEmployeeId: req.user.id } });
  return !!assignedTask;
}

// PATCH /api/payments/:id/status — manually set a payment's status.
// Body: { status }. Logs a PaymentEvent so there's a record of who
// changed it and when, visible in the payment's timeline.
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!PAYMENT_STATUS_VALUES.includes(status)) return res.status(400).json({ error: 'Not a valid status.' });
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (!(await canAccessPayment(req, payment))) return res.status(403).json({ error: 'Not authorized.' });
  const oldStatus = payment.status;
  const updated = await prisma.payment.update({
    where: { id: req.params.id },
    data: { status, ...(status === 'PAID' && !payment.paidAt ? { paidAt: new Date() } : {}) },
  });
  await prisma.paymentEvent.create({
    data: { paymentId: payment.id, type: 'STATUS_CHANGE', text: `Status changed from ${oldStatus} to ${status}`, actorId: req.user.id },
  });
  res.json(updated);
});

// PATCH /api/payments/:id/payment-instructions — sets the note for when
// a student is asked to pay to a different company number than usual.
router.patch('/:id/payment-instructions', requireAuth, async (req, res) => {
  const { paymentInstructions } = req.body;
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (!(await canAccessPayment(req, payment))) return res.status(403).json({ error: 'Not authorized.' });
  const updated = await prisma.payment.update({ where: { id: req.params.id }, data: { paymentInstructions: paymentInstructions || null } });
  await prisma.paymentEvent.create({
    data: { paymentId: payment.id, type: 'COMMENT', text: `Payment instructions updated: "${paymentInstructions}"`, actorId: req.user.id },
  });
  res.json(updated);
});

// POST /api/payments/:id/proof — upload a screenshot as proof of an
// alternate payment. Anyone who can see this payment can upload against
// it (staff on the student's behalf, or the student themselves) — this
// does NOT auto-change status; staff still confirms via /status once
// they've actually checked the screenshot matches a real payment.
router.post('/:id/proof', requireAuth, async (req, res) => {
  const { fileData, fileName } = req.body;
  if (!fileData) return res.status(400).json({ error: 'fileData is required.' });
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const isOwner = req.user.id === payment.studentId;
  if (!isOwner && !(await canAccessPayment(req, payment))) return res.status(403).json({ error: 'Not authorized.' });
  const event = await prisma.paymentEvent.create({
    data: { paymentId: payment.id, type: 'PROOF_UPLOAD', fileData, fileName: fileName || 'payment-proof', actorId: req.user.id },
  });
  res.status(201).json(event);
});

// POST /api/payments/:id/comment — a free-text note on the timeline.
router.post('/:id/comment', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const isOwner = req.user.id === payment.studentId;
  if (!isOwner && !(await canAccessPayment(req, payment))) return res.status(403).json({ error: 'Not authorized.' });
  const event = await prisma.paymentEvent.create({
    data: { paymentId: payment.id, type: 'COMMENT', text, actorId: req.user.id },
  });
  res.status(201).json(event);
});

// GET /api/payments/:id/events — the full unified timeline.
router.get('/:id/events', requireAuth, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const isOwner = req.user.id === payment.studentId;
  if (!isOwner && !(await canAccessPayment(req, payment))) return res.status(403).json({ error: 'Not authorized.' });
  const events = await prisma.paymentEvent.findMany({
    where: { paymentId: req.params.id },
    include: { actor: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(events);
});

module.exports = router;
