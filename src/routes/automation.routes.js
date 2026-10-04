const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { wrapPromotionEmailHtml } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

const VALID_TRIGGERS = {
  LEAD: ['LEAD_NO_RESPONSE_DAYS'],
  CHANNEL_PARTNER: ['PARTNER_NO_REFERRAL_DAYS'],
  EMPLOYEE: ['EMPLOYEE_BIRTHDAY', 'EMPLOYEE_WORK_ANNIVERSARY'],
};
const DAYS_BASED_TRIGGERS = ['LEAD_NO_RESPONSE_DAYS', 'PARTNER_NO_REFERRAL_DAYS'];

// GET /api/automation — Admin/Super Admin only.
// POST /api/automation/preview — Admin/Super Admin only. Renders the
// actual branded HTML email for whatever subject/body/CTA is currently
// being typed into the New Automation Rule form, before the rule is
// even saved — same rendering path the real send uses, so what's
// previewed is genuinely what will go out, not a mockup.
router.post('/preview', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, imageUrl, ctaText, ctaUrl } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });
  const personalizedBody = body.replace(/\{name\}/g, 'Ragi Harika');
  const html = wrapPromotionEmailHtml(subject, personalizedBody, imageUrl || null, ctaText || null, ctaUrl || null);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const rules = await prisma.automationRule.findMany({
    include: { createdBy: { select: { fullName: true } }, _count: { select: { sentLogs: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rules.map(r => ({
    id: r.id, name: r.name, targetAudience: r.targetAudience, triggerType: r.triggerType, triggerDays: r.triggerDays,
    channel: r.channel, subject: r.subject, body: r.body, imageUrl: r.imageUrl, ctaText: r.ctaText, ctaUrl: r.ctaUrl,
    active: r.active, createdAt: r.createdAt, createdByName: r.createdBy ? r.createdBy.fullName : null,
    totalSent: r._count.sentLogs,
  })));
});

// POST /api/automation — Admin/Super Admin only.
// Body: { name, targetAudience, triggerType, triggerDays?, channel, subject, body, imageUrl?, ctaText?, ctaUrl? }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name, targetAudience, triggerType, triggerDays, channel, subject, body, imageUrl, ctaText, ctaUrl } = req.body;
  if (!name || !targetAudience || !triggerType || !subject || !body) {
    return res.status(400).json({ error: 'name, targetAudience, triggerType, subject, and body are required.' });
  }
  if (!VALID_TRIGGERS[targetAudience] || !VALID_TRIGGERS[targetAudience].includes(triggerType)) {
    return res.status(400).json({ error: `"${triggerType}" isn't a valid trigger for ${targetAudience}.` });
  }
  if (DAYS_BASED_TRIGGERS.includes(triggerType) && !triggerDays) {
    return res.status(400).json({ error: 'triggerDays is required for this trigger type.' });
  }
  const resolvedChannel = ['EMAIL', 'WHATSAPP', 'BOTH'].includes(channel) ? channel : 'EMAIL';
  const rule = await prisma.automationRule.create({
    data: {
      name, targetAudience, triggerType,
      triggerDays: DAYS_BASED_TRIGGERS.includes(triggerType) ? parseInt(triggerDays) : null,
      channel: resolvedChannel, subject, body,
      imageUrl: imageUrl || null, ctaText: ctaText || null, ctaUrl: ctaUrl || null,
      createdById: req.user.id,
    },
  });
  res.status(201).json(rule);
});

// PATCH /api/automation/:id — Admin/Super Admin only. Mainly used to
// toggle active on/off without retyping the whole rule.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { active, name, subject, body, triggerDays, channel, imageUrl, ctaText, ctaUrl } = req.body;
  const rule = await prisma.automationRule.update({
    where: { id: req.params.id },
    data: {
      ...(active !== undefined ? { active } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(triggerDays !== undefined ? { triggerDays: parseInt(triggerDays) } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(ctaText !== undefined ? { ctaText } : {}),
      ...(ctaUrl !== undefined ? { ctaUrl } : {}),
    },
  });
  res.json(rule);
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.automationRule.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
