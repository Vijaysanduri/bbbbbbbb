const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/notifications/me — the signed-in person's own notifications,
// most recent first, plus how many are unread (for the bell's badge).
router.get('/me', requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user.id, read: false } });
  res.json({ notifications, unreadCount });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification || notification.userId !== req.user.id) return res.status(404).json({ error: 'Not found.' });
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { read: true } });
  res.json(updated);
});

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
  res.json({ success: true });
});

// POST /api/notifications/announce — Admin/Super Admin only. A company-
// wide update, sent to every active user (or a specific role) as an
// in-app notification — the "any update from company" case, distinct
// from Promotions (which is for external leads/students, not staff).
router.post('/announce', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { title, body, targetRole } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const recipients = await prisma.user.findMany({
    where: { active: true, ...(targetRole ? { role: targetRole } : {}) },
  });
  for (const person of recipients) {
    await createNotification(person.id, title, body, 'ANNOUNCEMENT', null);
  }
  res.status(201).json({ sentTo: recipients.length });
});

module.exports = router;
