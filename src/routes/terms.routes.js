const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const VALID_ROLES = ['STUDENT', 'EMPLOYEE', 'CHANNEL_PARTNER'];

// GET /api/terms/mine — any signed-in user. Returns their role's current
// T&C text plus whether they still need to accept it (never accepted,
// or accepted an older version that's since been edited).
router.get('/mine', requireAuth, async (req, res) => {
  const roleKey = req.user.role === 'CHANNEL_PARTNER' ? 'CHANNEL_PARTNER' : req.user.role === 'STUDENT' ? 'STUDENT' : 'EMPLOYEE';
  const terms = await prisma.termsAndConditions.findUnique({ where: { role: roleKey } });
  if (!terms) return res.json({ content: null, needsAcceptance: false });
  const needsAcceptance = !req.user.termsAcceptedAt || new Date(req.user.termsAcceptedAt) < new Date(terms.updatedAt);
  res.json({ content: terms.content, updatedAt: terms.updatedAt, needsAcceptance });
});

// POST /api/terms/accept — any signed-in user. Records "I Agree" right now.
router.post('/accept', requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { termsAcceptedAt: new Date() } });
  res.json({ success: true });
});

// GET /api/terms/:role — Admin/Super Admin only, for editing.
router.get('/:role', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const role = req.params.role.toUpperCase();
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Not a valid role.' });
  const terms = await prisma.termsAndConditions.findUnique({ where: { role } });
  res.json(terms || { role, content: '' });
});

// PUT /api/terms/:role — Admin/Super Admin only. Saving new text means
// everyone in that role who already accepted will be asked again next
// time they sign in, since their termsAcceptedAt now predates this update.
router.put('/:role', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const role = req.params.role.toUpperCase();
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Not a valid role.' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required.' });
  const terms = await prisma.termsAndConditions.upsert({
    where: { role },
    create: { role, content, updatedById: req.user.id },
    update: { content, updatedById: req.user.id },
  });
  res.json(terms);
});

module.exports = router;
