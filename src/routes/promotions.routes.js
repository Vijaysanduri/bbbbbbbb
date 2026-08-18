const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { sendMail, wrapPromotionEmailHtml } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/promotions/send — Admin/Super Admin only.
// Body: { subject, body, recipients: [{ name, email, phone }], recipientSource, imageUrl, ctaText, ctaUrl }
// recipientSource: "LEADS" | "UPLOAD" — just for the history log, doesn't
// change behavior. Sends email to everyone with an email address, and a
// WhatsApp message to everyone with a phone number — a person with both
// gets both. Failures for individual recipients don't stop the batch;
// the response reports how many actually went out.
router.post('/send', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, recipients, recipientSource, attachmentFileName, attachmentBase64, channel, whatsappMediaUrl, imageUrl, ctaText, ctaUrl } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });
  if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'At least one recipient is required.' });
  if (recipients.length > 2000) return res.status(400).json({ error: 'Please send to 2000 recipients or fewer at a time.' });
  // Defaults to 'email' if not specified, matching the pre-existing
  // behavior for any caller that hasn't been updated to send this yet —
  // but no longer silently fires WhatsApp too just because a phone
  // number happened to be on file. Sending both was wasting a message
  // every single time, with no way to pick just one.
  const wantsEmail = !channel || channel === 'email' || channel === 'both';
  const wantsWhatsApp = channel === 'whatsapp' || channel === 'both';

  let emailsSent = 0, whatsappSent = 0;
  for (const r of recipients) {
    if (wantsEmail && r.email) {
      try {
        const personalizedBody = body.replace(/\{name\}/g, r.name || 'there');
        await sendMail({
          to: r.email, subject, body: personalizedBody,
          attachmentFileName: attachmentFileName || undefined,
          attachmentBase64: attachmentBase64 || undefined,
          customHtml: wrapPromotionEmailHtml(subject, personalizedBody, imageUrl || null, ctaText || null, ctaUrl || null),
        });
        emailsSent++;
      } catch (err) { /* one bad address shouldn't stop the batch */ }
    }
    if (wantsWhatsApp && r.phone) {
      try {
        await sendWhatsApp({ to: r.phone, message: body.replace(/\{name\}/g, r.name || 'there'), mediaUrl: whatsappMediaUrl || undefined });
        whatsappSent++;
      } catch (err) { /* same — keep going */ }
    }
  }

  const promotion = await prisma.promotion.create({
    data: {
      subject, body, recipientSource: ['LEADS', 'UPLOAD', 'EMPLOYEE', 'CHANNEL_PARTNER', 'STUDENT', 'COLLABORATION'].includes(recipientSource) ? recipientSource : 'LEADS',
      recipientCount: recipients.length, emailsSent, whatsappSent, sentById: req.user.id,
    },
  });

  res.status(201).json(promotion);
});

// GET /api/promotions — Admin/Super Admin only. Send history.
router.get('/', requireAuth, requirePermission('canAccessPromotions', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const promotions = await prisma.promotion.findMany({
    include: { sentBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(promotions);
});

module.exports = router;
