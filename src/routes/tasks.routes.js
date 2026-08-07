const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail, renderTemplate, renderTaskStageTemplate, renderQuickCandidateTemplate, renderCaseUpdateTemplate, wrapEmailHtmlDesignB } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');
const { createNotification, notifyRecordWatchers } = require('../utils/notifications');

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

// Emails the fixed "case update" notification (Student's Name / Application
// Id / Institution / Program / Intake / Status / Title block) to the same
// audience as the in-app bell — assigned employee, their reporting
// manager, and every active Admin/Super Admin — minus whoever just made
// the change. This is deliberately a separate, smaller recipient fetch
// from notifyInternalTeam above rather than reusing it, since it needs
// the reporting manager too and each recipient's own name for the
// greeting line.
async function notifyCaseWatchersByEmail(task, title, actorId) {
  const recipientIds = new Set();
  if (task.assignedEmployeeId) {
    recipientIds.add(task.assignedEmployeeId);
    const assignee = await prisma.user.findUnique({ where: { id: task.assignedEmployeeId }, select: { reportingManagerId: true } });
    if (assignee && assignee.reportingManagerId) recipientIds.add(assignee.reportingManagerId);
  }
  const leadership = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true }, select: { id: true } });
  leadership.forEach(u => recipientIds.add(u.id));
  if (actorId) recipientIds.delete(actorId);
  const recipients = await prisma.user.findMany({ where: { id: { in: [...recipientIds] } }, select: { id: true, fullName: true, email: true } });
  const portalLink = `https://dream2fly.co.uk/D2fnew/login.html`;
  for (const person of recipients) {
    const { subject, body } = renderCaseUpdateTemplate({ recipientName: person.fullName, task, title, portalLink });
    try {
      await sendMail({ to: person.email, subject, body });
    } catch (err) {
      console.error(`[notifyCaseWatchersByEmail] Failed to email ${person.email}:`, err.message);
    }
  }
}

// POST /api/tasks/email-preview — any signed-in staff member. Renders
// the exact same branded HTML template a real candidate email would use
// (header/footer images, layout) without sending anything — powers the
// "Preview" button in the comment composer so staff can see what the
// candidate will actually receive before clicking Add. Registered here,
// before any /:id route, so "email-preview" is never mistaken for a task ID.
router.post('/email-preview', requireAuth, (req, res) => {
  const { subject, body } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required.' });
  const html = wrapEmailHtmlDesignB(subject || 'Message from Dream2Fly', body);
  res.json({ html });
});

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
      referredByPartner: { select: { id: true, fullName: true } },
    },
    orderBy: { due: 'asc' }
  });
  res.json(tasks);
});

// GET /api/tasks/me — Student only. Their own linked case(s), with the
// task handler's contact details and only the candidate-facing comments
// (not internal staff notes). Registered before GET /:id so "me" is
// never mistaken for a task ID.
router.get('/me', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { studentId: req.user.id },
    include: {
      assignedEmployee: { select: { fullName: true, phone: true, email: true, jobTitle: true } },
      comments: { where: { channel: 'CANDIDATE_FACING' }, orderBy: { createdAt: 'asc' }, include: { author: { select: { fullName: true } } } },
    },
    orderBy: { due: 'asc' },
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
      referredByPartner: { select: { id: true, fullName: true } },
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
  notifyRecordWatchers({
    assignedEmployeeId: task.assignedEmployeeId,
    actorId: req.user.id,
    title: `Task status updated`,
    body: `${req.user.fullName} changed "${task.title}" (${task.related}) status to "${status}".`,
    type: 'TASK_STATUS_CHANGED',
    link: 'tasks',
  }).catch(err => console.error('[tasks/:id/status] notifyRecordWatchers failed:', err.message));

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
  notifyRecordWatchers({
    assignedEmployeeId: task.assignedEmployeeId,
    actorId: req.user.id,
    title: `Task stage updated`,
    body: `${req.user.fullName} moved "${task.title}" (${task.related}) to "${stageLabel}".`,
    type: 'TASK_STAGE_CHANGED',
    link: 'tasks',
  }).catch(err => console.error('[tasks/:id/stage] notifyRecordWatchers failed:', err.message));

  res.json({ task: updated, email, candidateMailResult, candidateWhatsAppResult });
});

// PATCH /api/tasks/:id/overview
// Body: { overview }
// This is a single, always-current summary the employee overwrites each
// time — not appended to history like a comment. Anyone opening the case
// reads this first to know where things stand right now, without having
// to scroll the whole comment thread.
router.patch('/:id/overview', requireAuth, async (req, res) => {
  const { overview, course, college, fees, applicationId, intake } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...(overview !== undefined ? { overview } : {}),
      ...(course !== undefined ? { course } : {}),
      ...(college !== undefined ? { college } : {}),
      ...(applicationId !== undefined ? { applicationId } : {}),
      ...(intake !== undefined ? { intake } : {}),
      ...(fees !== undefined ? { fees } : {}),
    },
  });
  await logActivity(`${task.related} — overview updated.`, req.user.id);
  res.json(updated);
});

// PATCH /api/tasks/:id/interview-notes
// Body: { interviewNotes }
router.patch('/:id/interview-notes', requireAuth, async (req, res) => {
  const { interviewNotes } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({ where: { id: task.id }, data: { interviewNotes } });
  await logActivity(`${task.related} — interview notes updated.`, req.user.id);
  res.json(updated);
});

// POST /api/tasks/:id/comments
// Body: { text, attachmentUrl?, attachmentName?, channel? }
// channel: 'INTERNAL' (default, staff-only) or 'CANDIDATE_FACING' — the
// latter attempts a real email to the candidate right away, same as a
// chat message, not just an internal note.
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentName, channel, sendEmail } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const comment = await prisma.comment.create({
    data: { taskId: task.id, authorId: req.user.id, text, attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null, channel: channel === 'CANDIDATE_FACING' ? 'CANDIDATE_FACING' : 'INTERNAL' },
    include: { author: { select: { id: true, fullName: true } } }
  });

  // Posting to the Candidate tab emails by default — but sendEmail:false
  // lets an employee save a candidate-facing note without actually
  // sending it right now (e.g. drafting, or logging something they told
  // the candidate over a call instead of by email).
  let mailResult = null;
  if (channel === 'CANDIDATE_FACING' && sendEmail !== false) {
    if (!task.contactEmail) {
      return res.status(400).json({ error: 'Comment saved, but no email on file for this candidate — add one in Contact details to actually send it.', comment });
    }
    mailResult = await sendMail({
      to: task.contactEmail,
      subject: `Message from Dream2Fly regarding ${task.related}`,
      body: text,
      attachmentFileName: attachmentName || undefined,
      attachmentBase64: attachmentUrl || undefined,
    });
  }

  await logActivity(`${task.related} — ${text}`, req.user.id);
  notifyRecordWatchers({
    assignedEmployeeId: task.assignedEmployeeId,
    actorId: req.user.id,
    title: `New comment on ${task.related}`,
    body: `${req.user.fullName}: ${text.length > 100 ? text.slice(0, 100) + '…' : text}`,
    type: 'TASK_COMMENT',
    link: 'tasks',
  }).catch(err => console.error('[tasks/:id/comments] notifyRecordWatchers failed:', err.message));
  // Internal team notes stay in-app only — no email. Only a candidate-facing
  // message (something that actually went out to the applicant) is worth
  // an email to watchers; every internal back-and-forth getting its own
  // email would burn through the daily send limit fast for no real benefit
  // over the bell notification above.
  if (channel === 'CANDIDATE_FACING') {
    notifyCaseWatchersByEmail(task, 'Comment Received', req.user.id)
      .catch(err => console.error('[tasks/:id/comments] notifyCaseWatchersByEmail failed:', err.message));
  }
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

// PATCH /api/tasks/:id/assign — Admin/Super Admin/Manager only.
// Body: { assignedEmployeeId } — a real user ID reassigns it to them and
// emails them; null explicitly clears it back to "everyone" (open for
// anyone to pick up), matching the same pattern used for Leads.
router.patch('/:id/assign', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  const { assignedEmployeeId } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { assignedEmployeeId: assignedEmployeeId || null },
  });
  if (assignedEmployeeId) {
    const employee = await prisma.user.findUnique({ where: { id: assignedEmployeeId } });
    if (employee) {
      await sendMail({
        to: employee.email,
        subject: `Task assigned to you: ${updated.related}`,
        body: `Hi ${employee.fullName},\n\n"${updated.related}" has been assigned to you. Please review and follow up.\n\nBest,\nDream2Fly`,
      });
      await createNotification(employee.id, 'New task assigned', `"${updated.related}" has been assigned to you.`, 'TASK_ASSIGNED', 'tasks');
    }
  }
  await logActivity(`${updated.related} — ${assignedEmployeeId ? 'reassigned' : 'unassigned, now open for anyone'}.`, req.user.id);
  res.json(updated);
});

// PATCH /api/tasks/:id/link-student — Admin/Super Admin/Employee/Counsellor/Manager only.
// Body: { studentEmail } — finds an existing STUDENT-role account with
// that email and links this task to it, so the candidate can see their
// own case (task handler contact, comments, document checklist) once
// they log into their portal. Does not create an account — that already
// happens through normal student signup/onboarding.
router.patch('/:id/link-student', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { studentEmail } = req.body;
  if (!studentEmail) return res.status(400).json({ error: 'studentEmail is required.' });
  const student = await prisma.user.findFirst({ where: { email: studentEmail, role: 'STUDENT' } });
  if (!student) return res.status(404).json({ error: 'No student account found with that email. They need to sign up first.' });
  const task = await prisma.task.update({ where: { id: req.params.id }, data: { studentId: student.id } });
  await logActivity(`${task.related} linked to student portal account (${studentEmail}).`, req.user.id);
  res.json(task);
});

module.exports = router;
