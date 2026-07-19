const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { sendMail, renderTemplate } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  await prisma.activityLog.create({ data: { text, actorId } });
}

// POST /api/leads/public
// No auth required — this is what the public website's "Book a Free
// Consultation" form calls. Always tagged source=WEBSITE regardless of
// what the client sends, since anything submitted here genuinely came
// from the website.
router.post('/public', async (req, res) => {
  const { name, email, phone, service } = req.body;
  if (!name || !phone || !service) {
    return res.status(400).json({ error: 'name, phone and service are required.' });
  }
  const lead = await prisma.lead.create({
    data: {
      name,
      country: 'Not specified',
      service,
      source: 'WEBSITE',
      history: { create: [{ stage: 'ENQUIRY_RECEIVED' }] },
      comments: { create: [{ isSystem: true, text: 'Submitted via website consultation form.' + (email ? ' Email: ' + email : '') + (phone ? ' Phone: ' + phone : '') }] },
    },
  });
  await logActivity(name + ' submitted the website consultation form.', null);
  res.status(201).json({ success: true, message: 'Thanks — a counsellor will contact you shortly.' });
});

// GET /api/leads?name=&source=&country=&from=&to=
// Filters mirror the front-end filter bar exactly.
router.get('/', requireAuth, async (req, res) => {
  const { name, source, country, from, to } = req.query;
  const where = {
    ...(name ? { name: { contains: name } } : {}),
    ...(source ? { source } : {}),
    ...(country ? { country } : {}),
    ...(from || to
      ? { dateAdded: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {})
  };
  const leads = await prisma.lead.findMany({
    where,
    include: { history: { orderBy: { date: 'asc' } }, followUps: { orderBy: { date: 'desc' } }, comments: { orderBy: { createdAt: 'asc' } } },
    orderBy: { dateAdded: 'desc' }
  });
  res.json(leads);
});

// GET /api/leads/:id
router.get('/:id', requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { history: { orderBy: { date: 'asc' } }, followUps: { orderBy: { date: 'desc' } }, comments: { orderBy: { createdAt: 'asc' }, include: { author: true } } }
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  res.json(lead);
});

// POST /api/leads
// Body: { name, country, service, source }
router.post('/', requireAuth, async (req, res) => {
  const { name, country, service, source } = req.body;
  if (!name || !country || !service) {
    return res.status(400).json({ error: 'name, country and service are required.' });
  }
  const lead = await prisma.lead.create({
    data: {
      name, country, service, source: source || 'OTHER',
      assignedEmployeeId: req.user.id,
      history: { create: [{ stage: 'ENQUIRY_RECEIVED' }] }
    },
    include: { history: true, followUps: true, comments: true }
  });
  await logActivity(`${lead.name} added as a new lead.`, req.user.id);
  res.status(201).json(lead);
});

// PATCH /api/leads/:id/status
// Body: { status }  → returns the email that would be/was sent, and applies the change.
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status,
      history: { create: [{ stage: status }] },
      ...(status === 'CONVERTED' ? { convertedAt: new Date() } : {})
    }
  });

  const email = renderTemplate(status, lead.name);
  // In production, fetch the candidate's real email address from the
  // applicant record and pass it as `to`. Placeholder shown here since
  // the prototype doesn't yet store candidate contact emails.
  const mailResult = await sendMail({ to: `${lead.name.replace(/\s+/g, '.').toLowerCase()}@example.com`, subject: email.subject, body: email.body });

  await prisma.comment.create({
    data: { leadId: lead.id, isSystem: true, authorId: req.user.id, text: `Status changed to "${status}" — email ${mailResult.delivered ? 'sent' : 'logged'} to ${lead.name}.` }
  });
  await logActivity(`${lead.name} — status changed to "${status}".`, req.user.id);

  res.json({ lead: updated, email, mailResult });
});

// POST /api/leads/:id/followups
// Body: { type: 'CALL'|'MESSAGE'|'EMAIL', note }
router.post('/:id/followups', requireAuth, async (req, res) => {
  const { type, note } = req.body;
  if (!type || !note) return res.status(400).json({ error: 'type and note are required.' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const followUp = await prisma.followUp.create({ data: { leadId: lead.id, type, note } });
  await prisma.comment.create({ data: { leadId: lead.id, authorId: req.user.id, text: `[${type}] ${note}` } });
  await logActivity(`${lead.name} — ${type.toLowerCase()} logged: ${note}`, req.user.id);
  res.status(201).json(followUp);
});

// POST /api/leads/:id/comments
// Body: { text }
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const comment = await prisma.comment.create({ data: { leadId: lead.id, authorId: req.user.id, text }, include: { author: true } });
  await logActivity(`${lead.name} — ${text}`, req.user.id);
  res.status(201).json(comment);
});

// POST /api/leads/:id/convert
// Converts a lead into a task, carrying over source/service/history/follow-ups/comments
// as system comments on the new task — mirrors the front-end prototype's behaviour exactly.
router.post('/:id/convert', requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { history: { orderBy: { date: 'asc' } }, followUps: { orderBy: { date: 'asc' } }, comments: true }
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  if (lead.status === 'CONVERTED') return res.status(400).json({ error: 'This lead has already been converted.' });

  const due = new Date();
  due.setDate(due.getDate() + 3);

  const historyNote = lead.history.map(h => `${h.stage} (${h.date.toISOString().slice(0, 10)})`).join(' → ');
  const followupNote = lead.followUps.length
    ? lead.followUps.map(f => `[${f.type} ${f.date.toISOString().slice(0, 10)}] ${f.note}`).join(' | ')
    : 'No prior follow-ups logged.';

  const task = await prisma.task.create({
    data: {
      title: `Onboard converted lead — ${lead.name}`,
      related: lead.name,
      country: lead.country,
      due,
      priority: 'HIGH',
      status: 'PENDING',
      assignedEmployeeId: req.user.id,
      convertedFromLeadId: lead.id,
      comments: {
        create: [
          { isSystem: true, text: `Converted from lead ${lead.id} · source: ${lead.source} · service: ${lead.service}.` },
          { isSystem: true, text: `Journey so far: ${historyNote}` },
          { isSystem: true, text: `Follow-up history: ${followupNote}` },
          ...lead.comments.map(c => ({ isSystem: c.isSystem, text: c.text, authorId: c.authorId }))
        ]
      }
    },
    include: { comments: true }
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'CONVERTED', convertedAt: new Date(), history: { create: [{ stage: 'CONVERTED' }] } }
  });

  await logActivity(`${lead.name} converted from lead to a task — new sale.`, req.user.id);
  res.status(201).json({ task, message: `${lead.name} has been converted. A new task has been created with their full history attached.` });
});

module.exports = router;
