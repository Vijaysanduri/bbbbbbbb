const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
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
  const { name, email, phone, service, country } = req.body;
  if (!name || !phone || !service) {
    return res.status(400).json({ error: 'name, phone and service are required.' });
  }
  const lead = await prisma.lead.create({
    data: {
      name,
      country: country || 'Not specified',
      service,
      source: 'WEBSITE',
      contactPhone: phone || null,
      contactEmail: email || null,
      history: { create: [{ stage: 'ENQUIRY_RECEIVED' }] },
      comments: { create: [{ isSystem: true, text: 'Submitted via website registration form.' }] },
    },
  });
  await logActivity(name + ' submitted the website registration form.', null);
  res.status(201).json({ success: true, message: 'Thanks — a counsellor will contact you shortly.' });
});

// GET /api/leads?name=&source=&country=&from=&to=
// Filters mirror the front-end filter bar exactly.
router.get('/', requireAuth, async (req, res) => {
  const { name, source, country, from, to, tag } = req.query;
  const where = {
    ...(name ? { name: { contains: name } } : {}),
    ...(source ? { source } : {}),
    ...(country ? { country } : {}),
    ...(tag ? { currentTag: tag } : {}),
    // Channel Partners only ever see the applicants they referred
    // themselves — never anyone else's leads, employees', or the wider
    // pipeline. Admin/Employee continue to see everything, as before.
    ...(req.user.role === 'CHANNEL_PARTNER' ? { assignedEmployeeId: req.user.id } : {}),
    ...(from || to
      ? { dateAdded: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {})
  };
  const leads = await prisma.lead.findMany({
    where,
    include: {
      history: { orderBy: { date: 'asc' } },
      followUps: { orderBy: { date: 'desc' }, include: { loggedBy: { select: { id: true, fullName: true } } } },
      comments: { orderBy: { createdAt: 'asc' } },
      assignedEmployee: { select: { id: true, fullName: true } },
    },
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
  if (req.user.role === 'CHANNEL_PARTNER' && lead.assignedEmployeeId !== req.user.id) {
    return res.status(403).json({ error: 'Not your referral.' });
  }
  res.json(lead);
});

// POST /api/leads
// Body: { name, country, service, source }
router.post('/', requireAuth, async (req, res) => {
  const { name, country, service, source, contactPhone, contactEmail } = req.body;
  if (!name || !country || !service) {
    return res.status(400).json({ error: 'name, country and service are required.' });
  }
  const lead = await prisma.lead.create({
    data: {
      name, country, service, source: source || 'OTHER', contactPhone: contactPhone || null, contactEmail: contactEmail || null,
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
// POST /api/leads/:id/followups
// Body: { type: 'CALL'|'MESSAGE'|'EMAIL', note, tag, nextFollowUpAt }
// `tag` is the call-outcome tag (e.g. CALL_BACK_TODAY, NOT_RESPONDED) — this
// becomes the lead's `currentTag`, so leads can be filtered by "what
// happened last time we contacted them," separately from their pipeline
// status. `nextFollowUpAt` is an optional scheduled callback datetime,
// most useful when tag is CALL_BACK_TODAY / CALL_BACK_TOMORROW / CALL_BACK_LATER.
router.post('/:id/followups', requireAuth, async (req, res) => {
  const { type, note, tag, nextFollowUpAt } = req.body;
  if (!type || !note) return res.status(400).json({ error: 'type and note are required.' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const followUp = await prisma.followUp.create({ data: { leadId: lead.id, type, note, tag: tag || null, loggedById: req.user.id } });
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(tag ? { currentTag: tag } : {}),
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
    },
  });
  await prisma.comment.create({ data: { leadId: lead.id, authorId: req.user.id, text: `[${type}]${tag ? ' (' + tag.replace(/_/g, ' ') + ')' : ''} ${note}` } });
  await logActivity(`${lead.name} — ${type.toLowerCase()} logged${tag ? ' — ' + tag.replace(/_/g, ' ').toLowerCase() : ''}: ${note}`, req.user.id);
  res.status(201).json(followUp);
});

// POST /api/leads/:id/comments
// Body: { text, attachmentUrl?, attachmentName?, channel? }
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentName, channel } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const comment = await prisma.comment.create({
    data: { leadId: lead.id, authorId: req.user.id, text, attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null, channel: channel === 'CANDIDATE_FACING' ? 'CANDIDATE_FACING' : 'INTERNAL' },
    include: { author: { select: { id: true, fullName: true } } }
  });

  let mailResult = null;
  if (channel === 'CANDIDATE_FACING') {
    if (!lead.contactEmail) {
      return res.status(400).json({ error: 'Comment saved, but no email on file for this lead — add one first.', comment });
    }
    mailResult = await sendMail({ to: lead.contactEmail, subject: `Message from Dream2Fly regarding your enquiry`, body: text });
  }

  await logActivity(`${lead.name} — ${text}`, req.user.id);
  res.status(201).json({ comment, mailResult });
});

// POST /api/leads/:id/convert
// Converts a lead into a task, carrying over source/service/history/follow-ups/comments
// as system comments on the new task — mirrors the front-end prototype's behaviour exactly.
router.post('/:id/convert', requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      history: { orderBy: { date: 'asc' } },
      followUps: { orderBy: { date: 'asc' }, include: { loggedBy: { select: { fullName: true } } } },
      comments: { include: { author: { select: { fullName: true } } } },
      assignedEmployee: { select: { fullName: true } },
    }
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  if (lead.status === 'CONVERTED') return res.status(400).json({ error: 'This lead has already been converted.' });

  const due = new Date();
  due.setDate(due.getDate() + 3);

  const originalOwner = lead.assignedEmployee ? lead.assignedEmployee.fullName : 'Unassigned';
  const historyNote = lead.history.map(h => `${h.stage} (${h.date.toISOString().slice(0, 10)})`).join(' → ');
  const followupNote = lead.followUps.length
    ? lead.followUps.map(f => `[${f.type}${f.tag ? ' — ' + f.tag.replace(/_/g, ' ') : ''} · ${f.date.toISOString().slice(0, 10)} · by ${f.loggedBy ? f.loggedBy.fullName : 'unknown'}] ${f.note}`).join('\n')
    : 'No prior follow-ups logged.';
  const commentNote = lead.comments.length
    ? lead.comments.map(c => `[${c.createdAt.toISOString().slice(0, 10)} · ${c.isSystem ? 'System' : (c.author ? c.author.fullName : 'Unknown')}] ${c.text}`).join('\n')
    : 'No comments logged.';

  const task = await prisma.task.create({
    data: {
      title: `Onboard converted lead — ${lead.name}`,
      related: lead.name,
      country: lead.country,
      due,
      priority: 'HIGH',
      status: 'PENDING',
      stage: 'DOC_CHECKLIST_SENT',
      contactPhone: lead.contactPhone,
      contactEmail: lead.contactEmail,
      assignedEmployeeId: req.user.id,
      convertedFromLeadId: lead.id,
      comments: {
        create: [
          { isSystem: true, text: `⭐ CONVERTED FROM LEAD — originally handled by ${originalOwner}, converted by ${req.user.fullName}.\nSource: ${lead.source} · Service: ${lead.service} · Lead ID: ${lead.id}.` },
          { isSystem: true, text: `📈 Status journey: ${historyNote}` },
          { isSystem: true, text: `📞 Full call/follow-up history (with who made each contact):\n${followupNote}` },
          { isSystem: true, text: `💬 Full comment history from the lead stage:\n${commentNote}` },
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
  res.status(201).json({ task, message: `${lead.name} has been converted. A new task has been created with their full history attached — anyone this gets assigned to (including a senior colleague) can see exactly what happened and who they should ask if they have questions.` });
});

// PATCH /api/leads/:id — Admin/Super Admin only. Direct edit of a lead's
// core fields (not a status-change email flow — just correcting/updating
// data). For status changes with the candidate email, use PATCH /:id/status.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name, country, service, source, status, contactPhone, contactEmail } = req.body;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(name ? { name } : {}),
      ...(country ? { country } : {}),
      ...(service ? { service } : {}),
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(contactPhone !== undefined ? { contactPhone } : {}),
      ...(contactEmail !== undefined ? { contactEmail } : {}),
    },
  });
  await logActivity(`${updated.name} — edited by admin.`, req.user.id);
  res.json(updated);
});

// DELETE /api/leads/:id — Admin/Super Admin only. Cascades to that lead's
// history, follow-ups, and comments automatically (see schema.prisma).
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  await prisma.lead.delete({ where: { id: lead.id } });
  await logActivity(`${lead.name} — deleted by admin.`, req.user.id);
  res.json({ success: true });
});

// GET /api/leads/stats/employees?date=YYYY-MM-DD
// Admin/Super Admin only — real per-employee call activity, computed
// server-side so the numbers are trustworthy (not derived from whatever
// the browser happens to have loaded).
router.get('/stats/employees', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const dayStart = new Date(dateStr + 'T00:00:00.000Z');
  const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

  const employees = await prisma.user.findMany({
    where: { role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'] }, active: true },
    select: { id: true, fullName: true },
  });

  const stats = await Promise.all(employees.map(async (emp) => {
    const [callsToday, callBackPending, confirmed, converted] = await Promise.all([
      prisma.followUp.count({ where: { loggedById: emp.id, type: 'CALL', date: { gte: dayStart, lte: dayEnd } } }),
      prisma.lead.count({ where: { assignedEmployeeId: emp.id, currentTag: { in: ['CALL_BACK_TODAY', 'CALL_BACK_TOMORROW', 'CALL_BACK_LATER'] } } }),
      prisma.lead.count({ where: { assignedEmployeeId: emp.id, currentTag: 'CONFIRMED' } }),
      prisma.lead.count({ where: { assignedEmployeeId: emp.id, status: 'CONVERTED' } }),
    ]);
    return { employeeId: emp.id, employeeName: emp.fullName, callsToday, callBackPending, confirmed, converted };
  }));

  res.json({ date: dateStr, stats });
});

module.exports = router;
