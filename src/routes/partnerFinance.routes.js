const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

// ---------------- Commissions ----------------

// GET /api/partner-finance/commissions/me — the signed-in partner's own commissions.
router.get('/commissions/me', requireAuth, async (req, res) => {
  const commissions = await prisma.commission.findMany({
    where: { partnerId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(commissions);
});

// GET /api/partner-finance/commissions — Admin/Super Admin only, every commission across all partners.
router.get('/commissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const commissions = await prisma.commission.findMany({
    include: { partner: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(commissions);
});

// POST /api/partner-finance/commissions — Admin/Super Admin only.
// Body: { partnerId, leadName, amount, notes }
router.post('/commissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { partnerId, leadName, amount, notes } = req.body;
  if (!partnerId || !leadName || amount == null) {
    return res.status(400).json({ error: 'partnerId, leadName and amount are required.' });
  }
  const commission = await prisma.commission.create({
    data: { partnerId, leadName, amount: parseFloat(amount), notes: notes || null },
  });
  const partner = await prisma.user.findUnique({ where: { id: partnerId } });
  if (partner) {
    await sendMail({
      to: partner.email,
      subject: `Commission recorded — ${leadName}`,
      body: `Hi ${partner.fullName},\n\nA commission of ${amount} has been recorded for "${leadName}". You can track its status from your Partner dashboard.\n\nBest,\nDream2Fly`,
    });
  }
  res.status(201).json(commission);
});

// PATCH /api/partner-finance/commissions/:id — Admin/Super Admin only. Body: { status }
router.patch('/commissions/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { status } = req.body;
  if (!['PENDING', 'APPROVED', 'PAID'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const updated = await prisma.commission.update({ where: { id: req.params.id }, data: { status } });
  res.json(updated);
});

// ---------------- Invoices ----------------

// GET /api/partner-finance/invoices/me — the signed-in partner's own invoices.
router.get('/invoices/me', requireAuth, async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { partnerId: req.user.id },
    select: { id: true, invoiceNumber: true, amount: true, description: true, fileName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invoices);
});

// GET /api/partner-finance/invoices — Admin/Super Admin only.
router.get('/invoices', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    include: { partner: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invoices);
});

// GET /api/partner-finance/invoices/:id — download, owner or Admin only.
router.get('/invoices/:id', requireAuth, async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  if (!isStaff && invoice.partnerId !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
  res.json(invoice);
});

// POST /api/partner-finance/invoices — Channel Partner only.
// Body: { invoiceNumber, amount, description, fileName, mimeType, fileData }
router.post('/invoices', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { invoiceNumber, amount, description, fileName, mimeType, fileData } = req.body;
  if (!invoiceNumber || amount == null || !fileName || !fileData) {
    return res.status(400).json({ error: 'invoiceNumber, amount, fileName and fileData are required.' });
  }
  const invoice = await prisma.invoice.create({
    data: { partnerId: req.user.id, invoiceNumber, amount: parseFloat(amount), description: description || null, fileName, mimeType: mimeType || 'application/pdf', fileData },
  });
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `New invoice submitted: ${invoiceNumber} (${req.user.fullName})`,
      body: `${req.user.fullName} has submitted invoice ${invoiceNumber} for ${amount}. Review it in Admin → Partner Finance.`,
    });
  }
  res.status(201).json({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount });
});

// PATCH /api/partner-finance/invoices/:id — Admin/Super Admin only. Body: { status }
router.patch('/invoices/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { status } = req.body;
  if (!['SUBMITTED', 'PAID', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const invoice = await prisma.invoice.update({ where: { id: req.params.id }, data: { status } });
  const partner = await prisma.user.findUnique({ where: { id: invoice.partnerId } });
  if (partner) {
    await sendMail({
      to: partner.email,
      subject: `Invoice ${invoice.invoiceNumber} — ${status.toLowerCase()}`,
      body: `Hi ${partner.fullName},\n\nYour invoice ${invoice.invoiceNumber} has been marked as ${status.toLowerCase()}.\n\nBest,\nDream2Fly`,
    });
  }
  res.json(invoice);
});

module.exports = router;
