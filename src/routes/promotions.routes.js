const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/promotions/send — Admin/Super Admin only.
// Body: { subject, body, recipients: [{ name, email, phone }], recipientSource }
// recipientSource: "LEADS" | "UPLOAD" — just for the history log, doesn't
// change behavior. Sends email to everyone with an email address, and a
// WhatsApp message to everyone with a phone number — a person with both
// gets both. Failures for individual recipients don't stop the batch;
// the response reports how many actually went out.
router.post('/send', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, recipients, recipientSource, attachmentFileName, attachmentBase64 } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });
  if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'At least one recipient is required.' });
  if (recipients.length > 2000) return res.status(400).json({ error: 'Please send to 2000 recipients or fewer at a time.' });

  let emailsSent = 0, whatsappSent = 0;
  for (const r of recipients) {
    if (r.email) {
      try {
        await sendMail({
          to: r.email, subject, body: body.replace(/\{name\}/g, r.name || 'there'),
          attachmentFileName: attachmentFileName || undefined,
          attachmentBase64: attachmentBase64 || undefined,
        });
        emailsSent++;
      } catch (err) { /* one bad address shouldn't stop the batch */ }
    }
    if (r.phone) {
      try {
        await sendWhatsApp({ to: r.phone, message: body.replace(/\{name\}/g, r.name || 'there') });
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
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const promotions = await prisma.promotion.findMany({
    include: { sentBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(promotions);
});

module.exports = router;
