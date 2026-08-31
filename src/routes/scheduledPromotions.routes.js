const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const VALID_SOURCES = ['CHANNEL_PARTNER', 'STUDENT', 'EMPLOYEE'];
const VALID_FREQUENCIES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'];

// POST /api/scheduled-promotions — Admin/Super Admin only. Creates a
// campaign that fires on its own via the scheduler — see
// runScheduledPromotions in scheduler.js for the actual send logic.
router.post('/', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, recipientSource, channel, imageUrl, ctaText, ctaUrl, attachmentFileName, attachmentBase64, frequency, scheduledAt } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });
  if (!VALID_SOURCES.includes(recipientSource)) return res.status(400).json({ error: 'recipientSource must be one of: ' + VALID_SOURCES.join(', ') });
  if (!VALID_FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'frequency must be one of: ' + VALID_FREQUENCIES.join(', ') });
  if (!scheduledAt || isNaN(new Date(scheduledAt).getTime())) return res.status(400).json({ error: 'A valid scheduledAt date/time is required.' });

  const promo = await prisma.scheduledPromotion.create({
    data: {
      subject, body, recipientSource, channel: channel || 'email',
      imageUrl: imageUrl || null, ctaText: ctaText || null, ctaUrl: ctaUrl || null,
      attachmentFileName: attachmentFileName || null, attachmentBase64: attachmentBase64 || null,
      frequency, scheduledAt: new Date(scheduledAt), createdById: req.user.id,
    },
  });
  res.status(201).json(promo);
});

// GET /api/scheduled-promotions — Admin/Super Admin only. Everything
// currently scheduled, active or paused.
router.get('/', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const promos = await prisma.scheduledPromotion.findMany({
    include: { createdBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(promos);
});

// PATCH /api/scheduled-promotions/:id — Admin/Super Admin only. Used
// for pausing/resuming (active: false/true) or editing the schedule.
router.patch('/:id', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const existing = await prisma.scheduledPromotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const { subject, body, recipientSource, channel, imageUrl, ctaText, ctaUrl, frequency, scheduledAt, active } = req.body;
  const data = {};
  if (subject !== undefined) data.subject = subject;
  if (body !== undefined) data.body = body;
  if (recipientSource !== undefined) {
    if (!VALID_SOURCES.includes(recipientSource)) return res.status(400).json({ error: 'Invalid recipientSource.' });
    data.recipientSource = recipientSource;
  }
  if (channel !== undefined) data.channel = channel;
  if (imageUrl !== undefined) data.imageUrl = imageUrl;
  if (ctaText !== undefined) data.ctaText = ctaText;
  if (ctaUrl !== undefined) data.ctaUrl = ctaUrl;
  if (frequency !== undefined) {
    if (!VALID_FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'Invalid frequency.' });
    data.frequency = frequency;
  }
  if (scheduledAt !== undefined) data.scheduledAt = new Date(scheduledAt);
  if (active !== undefined) data.active = !!active;
  const updated = await prisma.scheduledPromotion.update({ where: { id: req.params.id }, data });
  res.json(updated);
});

// DELETE /api/scheduled-promotions/:id — Admin/Super Admin only.
router.delete('/:id', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const existing = await prisma.scheduledPromotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  await prisma.scheduledPromotion.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
