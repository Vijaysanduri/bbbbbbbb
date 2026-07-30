const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { sendMail, renderTemplate, renderTaskStageTemplate, renderQuickCandidateTemplate } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');

const router = express.Router();
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  await prisma.activityLog.create({ data: { text, actorId } });
}

// Always notify the assigned employee + every Admin/Super Admin internally
// when a task's stage changes — regardless of whether the candidate is
// also being notified. This is what lets a senior colleague who picks up
// someone else's case stay in the loop automatically.
async function notifyInternalTeam(task, changeDescription, actorName) {
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  const employee = task.assignedEmployeeId
    ? await prisma.user.findUnique({ where: { id: task.assignedEmployeeId } })
    : null;
  const recipients = [...admins, ...(employee ? [employee] : [])];
  const seen = new Set();
  for (const person of recipients) {
    if (seen.has(person.email)) continue;
    seen.add(person.email);
    await sendMail({
      to: person.email,
      subject: `[Internal] ${task.title} — ${changeDescription}`,
      body: `Hi ${person.fullName},\n\n${actorName} just updated "${task.title}" (related to ${task.related}):\n\n${changeDescription}\n\nThis is an internal notification — the candidate has been notified separately only if that was explicitly selected.\n\n— Dream2Fly System`,
    });
  }
}

// GET /api/tasks?name=&country=&from=&to=
router.get('/', requireAuth, async (req, res) => {
  const { name, country, from, to } = req.query;
  const where = {
    ...(name ? { related: { contains: name } } : {}),
    ...(country ? { country } : {}),
    ...(from || to ? { due: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {})
  };
  const tasks = await prisma.task.findMany({
    where,
    include: {
      comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, fullName: true } } } },
      assignedEmployee: { select: { id: true, fullName: true } },
    },
    orderBy: { due: 'asc' }
  });
  res.json(tasks);
});

// GET /api/tasks/:id
router.get('/:id', requireAuth, async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, fullName: true } } } },
      assignedEmployee: { select: { id: true, fullName: true } },
    }
  });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json(task);
});

// POST /api/tasks
// Body: { title, related, country, due, priority }
router.post('/', requireAuth, async (req, res) => {
  const { title, related, country, due, priority, contactPhone, contactEmail } = req.body;
  if (!title || !related || !country || !due) {
    return res.status(400).json({ error: 'title, related, country and due are required.' });
  }
  const task = await prisma.task.create({
    data: { title, related, country, due: new Date(due), priority: priority || 'MEDIUM', contactPhone: contactPhone || null, contactEmail: contactEmail || null, assignedEmployeeId: req.user.id }
  });
  await logActivity(`New task created: ${title} (related to ${related}).`, req.user.id);
  res.status(201).json(task);
});

// PATCH /api/tasks/:id/contact
// Body: { contactPhone, contactEmail }
router.patch('/:id/contact', requireAuth, async (req, res) => {
  const { contactPhone, contactEmail } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { ...(contactPhone !== undefined ? { contactPhone } : {}), ...(contactEmail !== undefined ? { contactEmail } : {}) },
  });
  res.json(updated);
});

// PATCH /api/tasks/:id/priority
// Body: { priority: 'LOW'|'MEDIUM'|'HIGH' }
router.patch('/:id/priority', requireAuth, async (req, res) => {
  const { priority } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({ where: { id: task.id }, data: { priority } });
  await logActivity(`${task.related} — task "${task.title}" priority changed to ${priority}.`, req.user.id);
  res.json(updated);
});

// PATCH /api/tasks/:id/status
// Body: { status }
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const updated = await prisma.task.update({ where: { id: task.id }, data: { status } });
  const email = renderTemplate(status, task.related);
  const mailResult = await sendMail({ to: `${task.related.replace(/\s+/g, '.').toLowerCase()}@example.com`, subject: email.subject, body: email.body });

  await prisma.comment.create({
    data: { taskId: task.id, isSystem: true, text: `Status changed to "${status}" — email ${mailResult.delivered ? 'sent' : 'logged'} to ${task.related}.` }
  });
  await logActivity(`${task.related} — task "${task.title}" status changed to "${status}".`, req.user.id);

  res.json({ task: updated, email, mailResult });
});

// PATCH /api/tasks/:id/stage
// Body: { stage, notifyCandidate: boolean, notifyCandidateVia: 'email'|'whatsapp'|'both'|'none' }
//
// This is the document-checklist → visa-approved pipeline. The employee
// or admin explicitly decides whether the candidate gets notified this
// time (notifyCandidate) — but the internal team (assigned employee +
// every Admin/Super Admin) is ALWAYS notified, so a case can be handed to
// a senior colleague without them having to dig through history to find
// out what's going on.
router.patch('/:id/stage', requireAuth, async (req, res) => {
  const { stage, notifyCandidate, notifyCandidateVia } = req.body;
  if (!stage) return res.status(400).json({ error: 'stage is required.' });
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const updated = await prisma.task.update({ where: { id: task.id }, data: { stage } });

  let candidateMailResult = { delivered: false, skipped: true };
  let candidateWhatsAppResult = { delivered: false, skipped: true };
  const email = renderTaskStageTemplate(stage, task.related);

  if (notifyCandidate) {
    const via = notifyCandidateVia || 'email';
    if (via === 'email' || via === 'both') {
      candidateMailResult = await sendMail({ to: `${task.related.replace(/\s+/g, '.').toLowerCase()}@example.com`, subject: email.subject, body: email.body });
    }
    if (via === 'whatsapp' || via === 'both') {
      candidateWhatsAppResult = await sendWhatsApp({ to: task.related, message: email.subject + '\n\n' + email.body });
    }
  }

  const stageLabel = stage.replace(/_/g, ' ');
  const noteText = `Stage changed to "${stageLabel}"` + (notifyCandidate ? ` — candidate notified (${notifyCandidateVia || 'email'}).` : ' — candidate was not notified this time.');
  await prisma.comment.create({ data: { taskId: task.id, isSystem: true, authorId: req.user.id, text: noteText } });
  await logActivity(`${task.related} — task "${task.title}" stage changed to "${stageLabel}".`, req.user.id);
  await notifyInternalTeam(updated, `Stage changed to "${stageLabel}".`, req.user.fullName);

  res.json({ task: updated, email, candidateMailResult, candidateWhatsAppResult });
});

// PATCH /api/tasks/:id/overview
// Body: { overview }
// This is a single, always-current summary the employee overwrites each
// time — not appended to history like a comment. Anyone opening the case
// reads this first to know where things stand right now, without having
// to scroll the whole comment thread.
router.patch('/:id/overview', requireAuth, async (req, res) => {
  const { overview } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({ where: { id: task.id }, data: { overview } });
  await logActivity(`${task.related} — overview updated.`, req.user.id);
  res.json(updated);
});

// POST /api/tasks/:id/comments
// Body: { text, attachmentUrl?, attachmentName?, channel? }
// channel: 'INTERNAL' (default, staff-only) or 'CANDIDATE_FACING' — the
// latter attempts a real email to the candidate right away, same as a
// chat message, not just an internal note.
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentName, channel } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const comment = await prisma.comment.create({
    data: { taskId: task.id, authorId: req.user.id, text, attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null, channel: channel === 'CANDIDATE_FACING' ? 'CANDIDATE_FACING' : 'INTERNAL' },
    include: { author: { select: { id: true, fullName: true } } }
  });

  let mailResult = null;
  if (channel === 'CANDIDATE_FACING') {
    if (!task.contactEmail) {
      return res.status(400).json({ error: 'Comment saved, but no email on file for this candidate — add one in Contact details to actually send it.', comment });
    }
    mailResult = await sendMail({ to: task.contactEmail, subject: `Message from Dream2Fly regarding ${task.related}`, body: text });
  }

  await logActivity(`${task.related} — ${text}`, req.user.id);
  res.status(201).json({ comment, mailResult });
});

// POST /api/tasks/:id/notify-candidate
// Body: { via: 'email'|'whatsapp'|'both', template: 'DOCUMENTS_PENDING'|'GENERAL_UPDATE'|'ALERT' }
// Routine one-off communication — separate from the automated stage-change
// emails. Uses the task's contactEmail/contactPhone, so those need to be
// filled in first (via PATCH /:id/contact) before this can be used.
router.post('/:id/notify-candidate', requireAuth, async (req, res) => {
  const { via, template, subject: customSubject, body: customBody } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const defaultTemplate = renderQuickCandidateTemplate(template, task.related);
  // If the employee edited the text client-side, send exactly what they
  // wrote — the template is just a starting point, not a locked script.
  const subject = (customSubject && customSubject.trim()) || defaultTemplate.subject;
  const body = (customBody && customBody.trim()) || defaultTemplate.body;
  let mailResult = { delivered: false, skipped: true };
  let whatsAppResult = { delivered: false, skipped: true };

  if (via === 'email' || via === 'both') {
    if (!task.contactEmail) return res.status(400).json({ error: 'No email address on file for this candidate yet — add one first.' });
    mailResult = await sendMail({ to: task.contactEmail, subject, body });
  }
  if (via === 'whatsapp' || via === 'both') {
    if (!task.contactPhone) return res.status(400).json({ error: 'No phone number on file for this candidate yet — add one first.' });
    whatsAppResult = await sendWhatsApp({ to: task.contactPhone, message: subject + '\n\n' + body });
  }

  await prisma.comment.create({
    data: { taskId: task.id, isSystem: true, authorId: req.user.id, text: `Sent "${template.replace(/_/g, ' ')}" message to candidate via ${via} — email ${mailResult.delivered ? 'sent' : mailResult.skipped ? 'skipped' : 'logged'}, WhatsApp ${whatsAppResult.delivered ? 'sent' : whatsAppResult.skipped ? 'skipped' : 'logged'}.` }
  });
  await logActivity(`${task.related} — sent "${template.replace(/_/g, ' ')}" message via ${via}.`, req.user.id);

  res.json({ subject, body, mailResult, whatsAppResult });
});

module.exports = router;
