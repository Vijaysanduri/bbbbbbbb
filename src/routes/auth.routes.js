const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/auth/login
// Body: { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  res.json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, jobTitle: user.jobTitle, phone: user.phone }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ id: user.id, fullName: user.fullName, email: user.email, role: user.role, jobTitle: user.jobTitle, phone: user.phone });
});

// PATCH /api/auth/me — update own phone number
router.patch('/me', requireAuth, async (req, res) => {
  const { phone } = req.body;
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { phone } });
  res.json({ id: user.id, phone: user.phone });
});

// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ success: true, message: 'Password updated. Please sign in again on other devices.' });
});

// GET /api/auth/employees — Admin/Super Admin only. Used for dropdowns
// (payslip upload, asset assignment, etc.) — not a general user directory.
router.get('/employees', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const employees = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(employees);
});

module.exports = router;
