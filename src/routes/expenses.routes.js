const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, requireHrCapability } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/expenses/me — the signed-in user's own submitted expenses.
router.get('/me', requireAuth, async (req, res) => {
  const expenses = await prisma.expense.findMany({
    where: { submittedById: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(expenses);
});

// POST /api/expenses — any signed-in employee submitting their own claim
// for reimbursement. Body: { amount, category, description, bankAccountDetails, receiptFileName, receiptMimeType, receiptFileData }
router.post('/', requireAuth, async (req, res) => {
  const { amount, category, description, bankAccountDetails, receiptFileName, receiptMimeType, receiptFileData } = req.body;
  if (amount == null || !category) return res.status(400).json({ error: 'amount and category are required.' });
  const expense = await prisma.expense.create({
    data: {
      expenseType: 'EMPLOYEE_CLAIM', submittedById: req.user.id, amount: parseFloat(amount), category, description: description || null,
      bankAccountDetails: bankAccountDetails || null,
      receiptFileName: receiptFileName || null, receiptMimeType: receiptMimeType || null, receiptFileData: receiptFileData || null,
    },
  });
  const employee = await prisma.user.findUnique({ where: { id: req.user.id }, include: { reportingManager: true } });
  const recipients = [];
  if (employee.reportingManager) recipients.push(employee.reportingManager);
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  recipients.push(...admins);
  const seen = new Set();
  for (const r of recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    await sendMail({
      to: r.email,
      subject: `New expense claim: ${category} (${req.user.fullName})`,
      body: `${req.user.fullName} has submitted an expense claim for ${amount} (${category}). Review it under Expenses.`,
    });
  }
  res.status(201).json(expense);
});

// POST /api/expenses/company — Admin/HR only. Records money the company
// itself paid out directly (no employee reimbursement involved) — who was
// paid, which account/cash it came from, and how. Auto-approved since
// Admin/HR entering it themselves already implies it's been authorized,
// but still fully logged with who recorded it and when.
// Body: { amount, category, description, paidTo, paidFromAccount, paymentMode, receiptFileName, receiptMimeType, receiptFileData }
router.post('/company', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { amount, category, description, paidTo, paidFromAccount, paymentMode, receiptFileName, receiptMimeType, receiptFileData } = req.body;
  if (amount == null || !category || !paidTo) return res.status(400).json({ error: 'amount, category and paidTo are required.' });
  const expense = await prisma.expense.create({
    data: {
      expenseType: 'COMPANY_EXPENSE', submittedById: req.user.id, amount: parseFloat(amount), category, description: description || null,
      paidTo, paidFromAccount: paidFromAccount || null, paymentMode: paymentMode || null,
      receiptFileName: receiptFileName || null, receiptMimeType: receiptMimeType || null, receiptFileData: receiptFileData || null,
      status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date(),
    },
  });
  res.status(201).json(expense);
});

// GET /api/expenses — Admin/Super Admin see every expense. Manager sees
// their own direct reports' claims. Anyone else only sees expenses
// explicitly shared with them by Admin.
router.get('/', requireAuth, async (req, res) => {
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  let where = { shares: { some: { userId: req.user.id } } };
  if (isStaff) where = {};
  else if (req.user.role === 'HR') {
    const settings = await prisma.roleCapabilitySettings.findUnique({ where: { id: 'singleton' } });
    if (!settings || settings.hrSeesExpenseFinancials !== false) where = {};
  }
  else if (req.user.role === 'MANAGER') where = { submittedBy: { reportingManagerId: req.user.id } };
  const expenses = await prisma.expense.findMany({
    where,
    include: { submittedBy: { select: { fullName: true, email: true } }, shares: { include: { user: { select: { id: true, fullName: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(expenses);
});

// GET /api/expenses/:id — submitter, Admin/Super Admin, their reporting manager, or anyone it's been shared with.
router.get('/:id', requireAuth, async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: { submittedBy: true, shares: { include: { user: { select: { id: true, fullName: true } } } } },
  });
  if (!expense) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const isOwner = expense.submittedById === req.user.id;
  const isManagerOfSubmitter = req.user.role === 'MANAGER' && expense.submittedBy.reportingManagerId === req.user.id;
  const isShared = expense.shares.some(s => s.userId === req.user.id);
  if (!isStaff && !isOwner && !isManagerOfSubmitter && !isShared) return res.status(403).json({ error: 'Not authorized.' });
  res.json(expense);
});

// PATCH /api/expenses/:id — Admin/Super Admin (any expense), or a Manager
// deciding on their own direct report's claim only. Body: { status, reviewNotes }
router.patch('/:id', requireAuth, async (req, res) => {
  const { status, reviewNotes } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { submittedBy: true } });
  if (!expense) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const isManagerOfSubmitter = req.user.role === 'MANAGER' && expense.submittedBy.reportingManagerId === req.user.id;
  if (!isStaff && !isManagerOfSubmitter) return res.status(403).json({ error: 'You do not have permission to do this.' });

  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: { status, reviewNotes: reviewNotes || null, reviewedById: req.user.id, reviewedAt: new Date() },
    include: { submittedBy: true },
  });
  await sendMail({
    to: updated.submittedBy.email,
    subject: `Your expense claim was ${status.toLowerCase()}`,
    body: `Hi ${updated.submittedBy.fullName},\n\nYour expense claim for ${updated.amount} (${updated.category}) has been ${status.toLowerCase()}.${status === 'APPROVED' ? ' Finance will use the bank details on file to deposit the reimbursement.' : ''}${reviewNotes ? '\n\nNote: ' + reviewNotes : ''}\n\nBest,\nDream2Fly`,
  });
  await logActivity(`${updated.submittedBy.fullName}'s expense claim (₹${updated.amount}, ${updated.category}) was ${status.toLowerCase()}.`, req.user.id);
  res.json(updated);
});

// GET /api/expenses/summary/monthly — Admin/Super Admin/HR only. Total
// COMPANY_EXPENSE spend grouped by month, for "how much spent per month
// for office purposes."
router.get('/summary/monthly', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const companyExpenses = await prisma.expense.findMany({ where: { expenseType: 'COMPANY_EXPENSE' } });
  const byMonth = {};
  companyExpenses.forEach(e => {
    const month = e.createdAt.toISOString().slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + e.amount;
  });
  res.json(byMonth);
});

// POST /api/expenses/:id/share — Admin/Super Admin only. Body: { userId }
// Grants a specific person visibility into this one expense — not a role
// or a blanket permission, just this record.
router.post('/:id/share', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  const share = await prisma.expenseShare.upsert({
    where: { expenseId_userId: { expenseId: req.params.id, userId } },
    update: {},
    create: { expenseId: req.params.id, userId, sharedById: req.user.id },
  });
  res.status(201).json(share);
});

// DELETE /api/expenses/:id/share/:userId — Admin/Super Admin only.
router.delete('/:id/share/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.expenseShare.delete({ where: { expenseId_userId: { expenseId: req.params.id, userId: req.params.userId } } });
  res.json({ success: true });
});

// ---------------- Office Expense Fund ("Current Balance") ----------------

// GET /api/expenses/fund/balance — Admin/Super Admin/HR only. Always
// computed fresh from the underlying transactions, never stored directly.
router.get('/fund/balance', requireAuth, async (req, res) => {
  if (!['ADMIN', 'SUPER_ADMIN', 'HR'].includes(req.user.role)) return res.status(403).json({ error: 'Not available for this role.' });
  const approvedFunds = await prisma.expenseFundTransaction.findMany({ where: { status: 'APPROVED' } });
  const totalAllocated = approvedFunds.reduce((sum, t) => sum + t.amount, 0);
  const companyExpenses = await prisma.expense.findMany({ where: { expenseType: 'COMPANY_EXPENSE', status: 'APPROVED' } });
  const totalSpent = companyExpenses.reduce((sum, e) => sum + e.amount, 0);
  res.json({ totalAllocated, totalSpent, balance: totalAllocated - totalSpent });
});

// GET /api/expenses/fund/history — Admin/Super Admin/HR only.
router.get('/fund/history', requireAuth, async (req, res) => {
  if (!['ADMIN', 'SUPER_ADMIN', 'HR'].includes(req.user.role)) return res.status(403).json({ error: 'Not available for this role.' });
  const transactions = await prisma.expenseFundTransaction.findMany({
    include: { requestedBy: { select: { fullName: true } }, reviewedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(transactions);
});

// POST /api/expenses/fund/allocate — Admin/Super Admin only. Directly
// adds funds, auto-approved (Admin doing this themselves is the approval).
// Body: { amount, notes }
router.post('/fund/allocate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { amount, notes } = req.body;
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'amount is required.' });
  const transaction = await prisma.expenseFundTransaction.create({
    data: { type: 'ALLOCATION', amount: parseFloat(amount), status: 'APPROVED', requestedById: req.user.id, reviewedById: req.user.id, reviewedAt: new Date(), notes: notes || null },
  });
  await logActivity(`₹${amount} added to the office expense fund.`, req.user.id);
  res.status(201).json(transaction);
});

// POST /api/expenses/fund/request — HR only. Requests more funds once the
// balance is running low — starts PENDING until Admin decides.
// Body: { amount, notes }
router.post('/fund/request', requireAuth, requireRole('HR'), async (req, res) => {
  const { amount, notes } = req.body;
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'amount is required.' });
  const transaction = await prisma.expenseFundTransaction.create({
    data: { type: 'REQUEST', amount: parseFloat(amount), status: 'PENDING', requestedById: req.user.id, notes: notes || null },
  });
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `Expense fund request: ₹${amount} (${req.user.fullName})`,
      body: `${req.user.fullName} has requested ₹${amount} for office expenses.${notes ? '\n\nReason: ' + notes : ''}\n\nReview it under Expenses → Current Balance.`,
    });
  }
  res.status(201).json(transaction);
});

// PATCH /api/expenses/fund/requests/:id — Admin/Super Admin only.
// Body: { status: 'APPROVED'|'REJECTED', reviewNotes }
router.patch('/fund/requests/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { status, reviewNotes } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const transaction = await prisma.expenseFundTransaction.update({
    where: { id: req.params.id },
    data: { status, reviewedById: req.user.id, reviewedAt: new Date(), notes: reviewNotes || undefined },
    include: { requestedBy: true },
  });
  await sendMail({
    to: transaction.requestedBy.email,
    subject: `Your fund request was ${status.toLowerCase()}`,
    body: `Hi ${transaction.requestedBy.fullName},\n\nYour request for ₹${transaction.amount} has been ${status.toLowerCase()}.${reviewNotes ? '\n\nNote: ' + reviewNotes : ''}\n\nBest,\nDream2Fly`,
  });
  res.json(transaction);
});

module.exports = router;
