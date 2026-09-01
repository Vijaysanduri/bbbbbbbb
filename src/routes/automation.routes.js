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
    include: { createdBy: { select: { fullName: true } }, _count: { select: { sentLogs: true } }, additionalMessages: { orderBy: { order: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rules.map(r => ({
    id: r.id, name: r.name, targetAudience: r.targetAudience, triggerType: r.triggerType, triggerDays: r.triggerDays,
    channel: r.channel, subject: r.subject, body: r.body, imageUrl: r.imageUrl, ctaText: r.ctaText, ctaUrl: r.ctaUrl,
    repeatDaily: r.repeatDaily,
    additionalMessages: r.additionalMessages,
    active: r.active, createdAt: r.createdAt, createdByName: r.createdBy ? r.createdBy.fullName : null,
    totalSent: r._count.sentLogs,
  })));
});

// POST /api/automation — Admin/Super Admin only.
// Body: { name, targetAudience, triggerType, triggerDays?, channel, subject, body, imageUrl?, ctaText?, ctaUrl? }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name, targetAudience, triggerType, triggerDays, channel, subject, body, imageUrl, ctaText, ctaUrl, repeatDaily } = req.body;
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
      // Only meaningful for LEAD_NO_RESPONSE_DAYS - silently ignored (stored
      // as false) for every other trigger type, since a one-time yearly
      // birthday/anniversary rule "repeating daily" wouldn't mean anything.
      repeatDaily: triggerType === 'LEAD_NO_RESPONSE_DAYS' ? !!repeatDaily : false,
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

// POST /api/automation/:id/messages — Admin/Super Admin only. Adds one
// more message to a rule's rotation. Same fields as the rule's own
// subject/body/ctaText/ctaUrl, plus optional activeFromMonth/
// activeToMonth (1-12) for seasonal content like intake reminders —
// leave both blank for evergreen content eligible year-round.
router.post('/:id/messages', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, imageUrl, ctaText, ctaUrl, activeFromMonth, activeToMonth } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });
  if ((activeFromMonth && !activeToMonth) || (!activeFromMonth && activeToMonth)) {
    return res.status(400).json({ error: 'Set both activeFromMonth and activeToMonth, or neither.' });
  }
  const rule = await prisma.automationRule.findUnique({ where: { id: req.params.id } });
  if (!rule) return res.status(404).json({ error: 'Rule not found.' });
  const maxOrder = await prisma.automationRuleMessage.aggregate({ where: { ruleId: rule.id }, _max: { order: true } });
  const message = await prisma.automationRuleMessage.create({
    data: {
      ruleId: rule.id, order: (maxOrder._max.order || 0) + 1,
      subject, body, imageUrl: imageUrl || null, ctaText: ctaText || null, ctaUrl: ctaUrl || null,
      activeFromMonth: activeFromMonth ? parseInt(activeFromMonth) : null,
      activeToMonth: activeToMonth ? parseInt(activeToMonth) : null,
    },
  });
  res.status(201).json(message);
});

// PATCH /api/automation/:id/messages/:messageId — Admin/Super Admin only.
router.patch('/:id/messages/:messageId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { subject, body, imageUrl, ctaText, ctaUrl, activeFromMonth, activeToMonth } = req.body;
  const existing = await prisma.automationRuleMessage.findUnique({ where: { id: req.params.messageId } });
  if (!existing || existing.ruleId !== req.params.id) return res.status(404).json({ error: 'Message not found.' });
  // Same check as the create endpoint - figure out what the two month
  // fields will actually be AFTER this update (an edit might only send
  // one of the two, leaving the other's existing saved value in place),
  // and reject if exactly one of them would end up set.
  const resolvedFrom = activeFromMonth !== undefined ? activeFromMonth : existing.activeFromMonth;
  const resolvedTo = activeToMonth !== undefined ? activeToMonth : existing.activeToMonth;
  if ((resolvedFrom && !resolvedTo) || (!resolvedFrom && resolvedTo)) {
    return res.status(400).json({ error: 'Set both activeFromMonth and activeToMonth, or neither.' });
  }
  const message = await prisma.automationRuleMessage.update({
    where: { id: req.params.messageId },
    data: {
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl || null } : {}),
      ...(ctaText !== undefined ? { ctaText: ctaText || null } : {}),
      ...(ctaUrl !== undefined ? { ctaUrl: ctaUrl || null } : {}),
      ...(activeFromMonth !== undefined ? { activeFromMonth: activeFromMonth ? parseInt(activeFromMonth) : null } : {}),
      ...(activeToMonth !== undefined ? { activeToMonth: activeToMonth ? parseInt(activeToMonth) : null } : {}),
    },
  });
  res.json(message);
});

// DELETE /api/automation/:id/messages/:messageId — Admin/Super Admin only.
router.delete('/:id/messages/:messageId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const existing = await prisma.automationRuleMessage.findUnique({ where: { id: req.params.messageId } });
  if (!existing || existing.ruleId !== req.params.id) return res.status(404).json({ error: 'Message not found.' });
  await prisma.automationRuleMessage.delete({ where: { id: req.params.messageId } });
  res.json({ success: true });
});

module.exports = router;
