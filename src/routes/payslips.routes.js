const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/payslips/me — my own payslips
router.get('/me', requireAuth, async (req, res) => {
  const slips = await prisma.payslip.findMany({
    where: { userId: req.user.id },
    select: { id: true, month: true, fileName: true, mimeType: true, createdAt: true },
    orderBy: { month: 'desc' },
  });
  res.json(slips);
});

// GET /api/payslips/:id — download (only your own, or Admin)
router.get('/:id', requireAuth, async (req, res) => {
  const slip = await prisma.payslip.findUnique({ where: { id: req.params.id } });
  if (!slip) return res.status(404).json({ error: 'Payslip not found.' });
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  if (!isAdmin && slip.userId !== req.user.id) return res.status(403).json({ error: 'Not your payslip.' });
  res.json(slip);
});

// GET /api/payslips — Admin/Super Admin only, every payslip across all employees
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const slips = await prisma.payslip.findMany({
    select: { id: true, month: true, fileName: true, createdAt: true, user: { select: { id: true, fullName: true } } },
    orderBy: { month: 'desc' },
  });
  res.json(slips);
});

// POST /api/payslips — Admin/Super Admin only.
// Body: { userId, month, fileName, mimeType, fileData }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { userId, month, fileName, mimeType, fileData } = req.body;
  if (!userId || !month || !fileName || !fileData) {
    return res.status(400).json({ error: 'userId, month, fileName and fileData are required.' });
  }
  const employee = await prisma.user.findUnique({ where: { id: userId } });
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });

  const slip = await prisma.payslip.create({
    data: { userId, month, fileName, mimeType: mimeType || 'application/pdf', fileData, uploadedById: req.user.id },
  });
  await sendMail({
    to: employee.email,
    subject: `Your payslip for ${month} is ready`,
    body: `Hi ${employee.fullName},\n\nYour payslip for ${month} has been uploaded and is now available in your Dream2Fly employee portal under Payslips.\n\nBest,\nDream2Fly HR`,
  });
  res.status(201).json({ id: slip.id, month: slip.month, fileName: slip.fileName });
});

// DELETE /api/payslips/:id — Admin/Super Admin only.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const slip = await prisma.payslip.findUnique({ where: { id: req.params.id } });
  if (!slip) return res.status(404).json({ error: 'Payslip not found.' });
  await prisma.payslip.delete({ where: { id: slip.id } });
  res.json({ success: true });
});

module.exports = router;
