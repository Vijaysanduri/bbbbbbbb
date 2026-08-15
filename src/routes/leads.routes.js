const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail, renderTemplate, renderQuickCandidateTemplate } = require('../utils/mailer');
const { sendWhatsApp } = require('../utils/whatsapp');
const { createNotification, notifyRecordWatchers } = require('../utils/notifications');

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
// Emails Admin/Super Admin the moment a new lead comes in — from the
// website or a Channel Partner — so leadership sees it immediately, not
// just whenever someone happens to check the dashboard. Deliberately NOT
// every staff member: the separate new-lead buzzer (banner + sound,
// polling-based — see /leads/new-since) already alerts every signed-in
// employee visually and audibly within 30 seconds, so they don't also
// need an email for the same event. Keeping this list to leadership only
// avoids burning through the daily email quota on high lead volume days.
async function notifyLeadershipOfNewLead(lead, sourceLabel) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true },
  });
  console.log(`[notifyLeadershipOfNewLead] Found ${staff.length} staff to notify for lead "${lead.name}":`, staff.map(p => p.email).join(', ') || '(none)');
  for (const person of staff) {
    try {
      const result = await sendMail({
        to: person.email,
        subject: `🔴 HIGH PRIORITY — New lead: ${lead.name} (${sourceLabel})`,
        body: `Hi ${person.fullName},\n\nA new lead has come in via ${sourceLabel} — please reach out quickly:\n\nName: ${lead.name}\nCountry: ${lead.country}\nService: ${lead.service}\n\nThis lead is currently unassigned. Whoever picks it up first should assign it to themselves and reach out right away. It will be auto-assigned within 30 minutes if no one does.\n\nBest,\nDream2Fly`,
      });
      console.log(`[notifyLeadershipOfNewLead] sendMail result for ${person.email}:`, result);
    } catch (err) {
      // One recipient's mailbox/SMTP hiccup should never stop the rest of
      // the team from being notified, and should never be allowed to
      // propagate up into the request that's creating the lead itself.
      console.error(`[notifyLeadershipOfNewLead] Failed to email ${person.email}:`, err.message);
    }
  }
}

// Sends an automatic initial greeting on WhatsApp the moment any new lead
// comes in — so the candidate hears from Dream2Fly right away, while
// employees are still deciding who's picking it up (the popup+buzzer
// alert is the employee-facing half of this same moment). Real delivery
// only happens once TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM are configured — until then
// this safely logs instead, exactly like every other not-yet-configured
// integration in this app.
async function sendInitialWhatsAppGreeting(lead) {
  const number = lead.whatsappNumber || lead.contactPhone;
  if (!number) return;
  const firstName = (lead.name || '').split(' ')[0];
  const message = `Hi ${firstName || 'there'}! 👋 Thanks for reaching out to Dream2Fly Consulting regarding ${lead.service || 'your enquiry'}${lead.country ? ' for ' + lead.country : ''}. One of our counsellors will call you shortly to understand your requirements and guide you through the next steps. In the meantime, feel free to reply here with any questions!`;
  await sendWhatsApp({ to: number, message });
}

router.post('/public', async (req, res) => {
  const { name, email, phone, service, country } = req.body;
  if (!name || !phone || !service) {
    return res.status(400).json({ error: 'name, phone and service are required.' });
  }

  // If this email OR phone already has a lead, someone re-submitting the
  // form (didn't hear back, used a different device, wanted to be sure
  // it went through, etc.) would otherwise create a second duplicate
  // record — its own buzzer alert, its own row in Applicants, their call
  // and enquiry history split across two files instead of one. Match on
  // either contact detail so everything about this person lands in a
  // single file, however they get in touch.
  const existingLead = (email || phone)
    ? await prisma.lead.findFirst({
        where: {
          OR: [
            ...(email ? [{ contactEmail: { equals: email, mode: 'insensitive' } }] : []),
            ...(phone ? [{ contactPhone: phone }] : []),
          ],
        },
        orderBy: { dateAdded: 'desc' },
      })
    : null;

  if (existingLead) {
    const matchedOn = email && existingLead.contactEmail && existingLead.contactEmail.toLowerCase() === email.toLowerCase() ? 'email' : 'phone number';
    await prisma.lead.update({
      where: { id: existingLead.id },
      data: {
        comments: { create: [{ isSystem: true, text: `Submitted the website form again (matched by ${matchedOn}) — renewed interest. (Service: ${service}${country ? ', Country: ' + country : ''})` }] },
      },
    });
    await logActivity(`${name} submitted the website form again — matched to their existing enquiry.`, null);
    res.status(200).json({ success: true, message: 'Thanks — we already have your enquiry and a counsellor will follow up shortly.' });
    // Not treated as a brand-new lead (no buzzer, no "HIGH PRIORITY" blast)
    // since it isn't one — but whoever's already handling it (or
    // leadership, if it's still unassigned) should know the candidate is
    // trying again, since that often means the first outreach didn't land.
    notifyRecordWatchers({
      assignedEmployeeId: existingLead.assignedEmployeeId,
      title: `Renewed interest from ${name}`,
      body: `${name} submitted the website form again — they may not have heard back yet.`,
      type: 'LEAD_COMMENT',
      link: 'applicants',
    }).catch(err => console.error('[leads/public] notifyRecordWatchers (repeat submission) failed:', err.message));
    if (!existingLead.assignedEmployeeId) {
      notifyLeadershipOfNewLead(existingLead, 'Website — repeat submission, still unassigned')
        .catch(err => console.error('[leads/public] notifyLeadershipOfNewLead (repeat submission) failed:', err.message));
    }
    return;
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
  // Respond to the person right away — they should never sit on
  // "Submitting…" because an internal notification email or WhatsApp
  // message is slow or unreachable. Those run in the background; any
  // failure is caught and logged inside each function, never surfaced
  // to the visitor filling out the form.
  res.status(201).json({ success: true, message: 'Thanks — a counsellor will contact you shortly.' });
  notifyLeadershipOfNewLead(lead, 'Website').catch(err => console.error('[leads/public] notifyLeadershipOfNewLead failed:', err.message));
  sendInitialWhatsAppGreeting(lead).catch(err => console.error('[leads/public] sendInitialWhatsAppGreeting failed:', err.message));
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
      history: { orderBy: { date: 'asc' }, include: { actor: { select: { fullName: true } } } },
      followUps: { orderBy: { date: 'desc' }, include: { loggedBy: { select: { id: true, fullName: true } } } },
      comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, fullName: true } } } },
      assignedEmployee: { select: { id: true, fullName: true } },
      referredByPartner: { select: { id: true, fullName: true } },
    },
    orderBy: { dateAdded: 'desc' }
  });
  res.json(leads);
});

// GET /api/leads/:id
// GET /api/leads/sla-status — Admin/Super Admin/Manager only. The daily
// standup view: leads unassigned, leads awaiting first contact, and
// leads with no update logged today. Registered before GET /:id so
// "sla-status" is never mistaken for a lead ID.
router.get('/sla-status', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const unassigned = await prisma.lead.findMany({
    where: { assignedAt: null, status: { not: 'CONVERTED' } },
    select: { id: true, name: true, country: true, service: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const awaitingContact = await prisma.lead.findMany({
    where: { assignedAt: { not: null }, status: { not: 'CONVERTED' } },
    include: { followUps: true, assignedEmployee: { select: { fullName: true } } },
  });
  const stillAwaitingContact = awaitingContact
    .filter(l => l.followUps.length === 0)
    .map(l => ({ id: l.id, name: l.name, assignedTo: l.assignedEmployee?.fullName, assignedAt: l.assignedAt }));

  const activeLeads = await prisma.lead.findMany({
    where: { status: { not: 'CONVERTED' } },
    include: { followUps: { orderBy: { date: 'desc' }, take: 1 }, comments: { orderBy: { createdAt: 'desc' }, take: 1 }, assignedEmployee: { select: { fullName: true } } },
  });
  const noProgressToday = activeLeads
    .filter(l => {
      const lastActivity = [l.followUps[0]?.date, l.comments[0]?.createdAt].filter(Boolean).sort().pop();
      return !lastActivity || new Date(lastActivity) < todayStart;
    })
    .map(l => ({ id: l.id, name: l.name, assignedTo: l.assignedEmployee?.fullName }));

  res.json({ unassigned, stillAwaitingContact, noProgressToday });
});

// GET /api/leads/new-since?since=ISO_TIMESTAMP — any signed-in staff
// member (not Partner/Student). Powers the in-app popup+buzzer alert —
// the dashboard polls this every 30s with the last time it checked, and
// gets back anything created since then. Registered before GET /:id so
// "new-since" is never mistaken for a lead ID.
router.get('/new-since', requireAuth, async (req, res) => {
  if (['CHANNEL_PARTNER', 'STUDENT'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Not available for this role.' });
  }
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 60 * 1000);
  const newLeads = await prisma.lead.findMany({
    where: { dateAdded: { gt: since } },
    select: { id: true, name: true, country: true, service: true, source: true, dateAdded: true },
    orderBy: { dateAdded: 'asc' },
  });
  res.json({ checkedAt: new Date().toISOString(), newLeads });
});

router.get('/:id', requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { history: { orderBy: { date: 'asc' } }, followUps: { orderBy: { date: 'desc' } }, comments: { orderBy: { createdAt: 'asc' }, include: { author: true } }, referredByPartner: { select: { id: true, fullName: true } } }
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
  const { name, country, service, source, contactPhone, contactEmail, whatsappNumber, resumeFileData, resumeFileName } = req.body;
  const isPartner = req.user.role === 'CHANNEL_PARTNER';
  // Partners only capture minimal contact info — everything else (country,
  // service, full requirements) is gathered by the employee once assigned.
  if (isPartner) {
    if (!name || !contactPhone) {
      return res.status(400).json({ error: 'Full name and phone number are required.' });
    }
  } else if (!name || !country || !service) {
    return res.status(400).json({ error: 'name, country and service are required.' });
  }
  const lead = await prisma.lead.create({
    data: {
      name,
      country: country || 'Not specified',
      service: service || 'General Enquiry',
      source: source || (isPartner ? 'REFERRAL' : 'OTHER'),
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      whatsappNumber: whatsappNumber || null,
      resumeFileData: resumeFileData || null,
      resumeFileName: resumeFileName || null,
      assignedEmployeeId: req.user.id,
      assignedAt: isPartner ? null : new Date(),
      referredByPartnerId: isPartner ? req.user.id : null,
      history: { create: [{ stage: 'ENQUIRY_RECEIVED', actorId: req.user.id }] }
    },
    include: { history: true, followUps: true, comments: true }
  });
  await logActivity(`${lead.name} added as a new lead.`, req.user.id);
  if (isPartner) {
    await notifyLeadershipOfNewLead(lead, 'Channel Partner referral');
  } else if (lead.source === 'INSTAGRAM' || lead.source === 'FACEBOOK') {
    await notifyLeadershipOfNewLead(lead, lead.source === 'INSTAGRAM' ? 'Instagram' : 'Facebook');
  }
  await sendInitialWhatsAppGreeting(lead);
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
      history: { create: [{ stage: status, actorId: req.user.id }] },
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
  notifyRecordWatchers({
    assignedEmployeeId: lead.assignedEmployeeId,
    actorId: req.user.id,
    title: `Lead status updated`,
    body: `${req.user.fullName} changed ${lead.name}'s status to "${status}".`,
    type: 'LEAD_STATUS_CHANGED',
    link: 'applicants',
  }).catch(err => console.error('[leads/:id/status] notifyRecordWatchers failed:', err.message));

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

// POST /api/leads/:id/notify-candidate — Via email, WhatsApp, or both.
// Mirrors POST /api/tasks/:id/notify-candidate exactly, so a lead gets
// the same tracked communication a task does — the only reason this
// didn't already exist is that WhatsApp support was originally only
// built for tasks; this closes that gap so a candidate is fully tracked
// whether they're still a lead or have already been converted.
router.post('/:id/notify-candidate', requireAuth, async (req, res) => {
  const { via, template, subject: customSubject, body: customBody } = req.body;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const defaultTemplate = renderQuickCandidateTemplate(template, lead.name);
  const subject = (customSubject && customSubject.trim()) || defaultTemplate.subject;
  const body = (customBody && customBody.trim()) || defaultTemplate.body;
  let mailResult = { delivered: false, skipped: true };
  let whatsAppResult = { delivered: false, skipped: true };

  if (via === 'email' || via === 'both') {
    if (!lead.contactEmail) return res.status(400).json({ error: 'No email address on file for this candidate yet — add one first.' });
    mailResult = await sendMail({ to: lead.contactEmail, subject, body });
  }
  if (via === 'whatsapp' || via === 'both') {
    const number = lead.whatsappNumber || lead.contactPhone;
    if (!number) return res.status(400).json({ error: 'No phone number on file for this candidate yet — add one first.' });
    whatsAppResult = await sendWhatsApp({ to: number, message: subject + '\n\n' + body });
  }

  await prisma.comment.create({
    data: { leadId: lead.id, isSystem: true, authorId: req.user.id, text: `Sent "${template.replace(/_/g, ' ')}" message to candidate via ${via} — email ${mailResult.delivered ? 'sent' : mailResult.skipped ? 'skipped' : 'logged'}, WhatsApp ${whatsAppResult.delivered ? 'sent' : whatsAppResult.skipped ? 'skipped' : 'logged'}.` }
  });
  await logActivity(`${lead.name} — sent "${template.replace(/_/g, ' ')}" message via ${via}.`, req.user.id);

  res.json({ subject, body, mailResult, whatsAppResult });
});

// POST /api/leads/:id/comments
// Body: { text, attachmentUrl?, attachmentName?, channel? }
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentName, channel, sendEmail } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  const comment = await prisma.comment.create({
    data: { leadId: lead.id, authorId: req.user.id, text, attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null, channel: channel === 'CANDIDATE_FACING' ? 'CANDIDATE_FACING' : 'INTERNAL' },
    include: { author: { select: { id: true, fullName: true } } }
  });

  let mailResult = null;
  if (channel === 'CANDIDATE_FACING' && sendEmail !== false) {
    if (!lead.contactEmail) {
      return res.status(400).json({ error: 'Comment saved, but no email on file for this lead — add one first.', comment });
    }
    mailResult = await sendMail({
      to: lead.contactEmail,
      subject: `Message from Dream2Fly regarding your enquiry`,
      body: text,
      attachmentFileName: attachmentName || undefined,
      attachmentBase64: attachmentUrl || undefined,
    });
  }

  await logActivity(`${lead.name} — ${text}`, req.user.id);
  notifyRecordWatchers({
    assignedEmployeeId: lead.assignedEmployeeId,
    actorId: req.user.id,
    title: `New comment on ${lead.name}`,
    body: `${req.user.fullName}: ${text.length > 100 ? text.slice(0, 100) + '…' : text}`,
    type: 'LEAD_COMMENT',
    link: 'applicants',
  }).catch(err => console.error('[leads/:id/comments] notifyRecordWatchers failed:', err.message));
  res.status(201).json({ comment, mailResult });
});

// POST /api/leads/:id/convert
// Converts a lead into a task, carrying over source/service/history/follow-ups/comments
// as system comments on the new task — mirrors the front-end prototype's behaviour exactly.
router.post('/:id/convert', requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      history: { orderBy: { date: 'asc' }, include: { actor: { select: { fullName: true } } } },
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
      // Only carries over when it's an exact match — a lead's service
      // can also be "Visiting Visa" or "Tourist Visa", which don't fit
      // either of Task's two supported case types. Left unset rather
      // than guessed at in that case; staff can set it manually.
      caseType: ['Work Visa', 'Student Visa'].includes(lead.service) ? lead.service : null,
      referredByPartnerId: lead.referredByPartnerId,
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
    data: { status: 'CONVERTED', convertedAt: new Date(), history: { create: [{ stage: 'CONVERTED', actorId: req.user.id }] } }
  });

  await logActivity(`${lead.name} converted from lead to a task — new sale.`, req.user.id);
  res.status(201).json({ task, message: `${lead.name} has been converted. A new task has been created with their full history attached — anyone this gets assigned to (including a senior colleague) can see exactly what happened and who they should ask if they have questions.` });
});

// PATCH /api/leads/:id — Admin/Super Admin only. Direct edit of a lead's
// core fields (not a status-change email flow — just correcting/updating
// data). For status changes with the candidate email, use PATCH /:id/status.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  const { name, country, service, source, status, contactPhone, contactEmail, assignedEmployeeId } = req.body;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  // assignedEmployeeId === undefined means "don't touch it"; null explicitly
  // means "unassign — open for anyone to claim"; any other value is a
  // real reassignment. Distinguishing these matters: a falsy check alone
  // would make it impossible to ever clear an assignment back to "everyone."
  const isChangingAssignment = assignedEmployeeId !== undefined && assignedEmployeeId !== lead.assignedEmployeeId;
  const isReassigningToSomeone = isChangingAssignment && !!assignedEmployeeId;
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
      ...(isChangingAssignment ? { assignedEmployeeId: assignedEmployeeId || null, assignedAt: isReassigningToSomeone ? new Date() : null, unassignedAlertSent: !isReassigningToSomeone, contactAlertSent: false } : {}),
    },
  });
  await logActivity(`${updated.name} — edited by admin.`, req.user.id);
  if (isReassigningToSomeone) {
    const employee = await prisma.user.findUnique({ where: { id: assignedEmployeeId } });
    if (employee) {
      await sendMail({
        to: employee.email,
        subject: `Lead assigned to you: ${updated.name}`,
        body: `Hi ${employee.fullName},\n\n"${updated.name}" (${updated.country}, ${updated.service}) has been assigned to you. Please reach out as soon as possible — this is tracked against a 30-minute first-contact target.\n\nBest,\nDream2Fly`,
      });
      await createNotification(employee.id, 'New lead assigned', `"${updated.name}" (${updated.country}, ${updated.service}) has been assigned to you.`, 'LEAD_ASSIGNED', 'applicants');
    }
  }
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
  const { employeeId, country } = req.query;
  const todayStr = new Date().toISOString().slice(0, 10);
  // req.query values can arrive as arrays, empty strings, or garbage from a
  // malformed request — any of which produced an "Invalid Date" that
  // crashed this entire page for every admin. Coerce to a plain string
  // and validate the resulting Date before using it, falling back to
  // today's range rather than 500ing the whole Employees view.
  const rawFrom = Array.isArray(req.query.from) ? req.query.from[0] : (req.query.from || req.query.date);
  const rawTo = Array.isArray(req.query.to) ? req.query.to[0] : (req.query.to || req.query.date);
  const fromStr = (typeof rawFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom)) ? rawFrom : todayStr;
  const toStr = (typeof rawTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawTo)) ? rawTo : todayStr;
  let rangeStart = new Date(fromStr + 'T00:00:00.000Z');
  let rangeEnd = new Date(toStr + 'T23:59:59.999Z');
  if (isNaN(rangeStart.getTime())) rangeStart = new Date(todayStr + 'T00:00:00.000Z');
  if (isNaN(rangeEnd.getTime())) rangeEnd = new Date(todayStr + 'T23:59:59.999Z');

  const employees = await prisma.user.findMany({
    where: { role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'] }, active: true, ...(employeeId ? { id: employeeId } : {}) },
    select: { id: true, fullName: true },
  });

  const stats = await Promise.all(employees.map(async (emp) => {
    const leadWhere = { assignedEmployeeId: emp.id, ...(country ? { country } : {}) };
    const [callsInRange, callBackPending, confirmed, converted, leadsByStatusRaw] = await Promise.all([
      prisma.followUp.count({ where: { loggedById: emp.id, type: 'CALL', date: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.lead.count({ where: { ...leadWhere, currentTag: { in: ['CALL_BACK_TODAY', 'CALL_BACK_TOMORROW', 'CALL_BACK_LATER'] } } }),
      prisma.lead.count({ where: { ...leadWhere, currentTag: 'CONFIRMED' } }),
      prisma.lead.count({ where: { ...leadWhere, status: 'CONVERTED' } }),
      prisma.lead.groupBy({ by: ['status'], where: leadWhere, _count: true }),
    ]);
    const leadsByStatus = {};
    leadsByStatusRaw.forEach(row => { leadsByStatus[row.status] = row._count; });
    return { employeeId: emp.id, employeeName: emp.fullName, callsInRange, callBackPending, confirmed, converted, leadsByStatus };
  }));

  res.json({ from: fromStr, to: toStr, stats });
});

// POST /api/leads/auto-assign — Admin/Super Admin/Manager only. Manually
// triggers the same auto-assignment logic the 5-minute scheduler runs
// automatically — useful for "assign right now" instead of waiting.
router.post('/auto-assign', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  const { autoAssignStaleLeads } = require('../utils/slaScheduler');
  const result = await autoAssignStaleLeads();
  res.json(result);
});

module.exports = router;
