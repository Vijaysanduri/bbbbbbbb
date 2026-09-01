// The actual background job behind Promotions Automation — checks every
// active rule periodically and messages anyone currently matching it.
//
// Deliberately uses Node's built-in setInterval rather than a cron
// library — this backend already has one dependency (jszip) I couldn't
// fully verify in the environment I built it in, and I'm not willing to
// add a second unverified one just for scheduling when a plain interval
// does the same job with zero extra risk.

const { PrismaClient } = require('@prisma/client');
const { sendMail, wrapPromotionEmailHtml } = require('./mailer');
const { sendWhatsApp } = require('./whatsapp');

const prisma = new PrismaClient();

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

async function runAutomationCheck() {
  try {
    const activeRules = await prisma.automationRule.findMany({ where: { active: true }, include: { additionalMessages: true } });
    for (const rule of activeRules) {
      if (rule.triggerType === 'LEAD_NO_RESPONSE_DAYS') await processLeadNoResponseRule(rule);
      else if (rule.triggerType === 'PARTNER_NO_REFERRAL_DAYS') await processPartnerNoReferralRule(rule);
      else if (rule.triggerType === 'EMPLOYEE_BIRTHDAY') await processEmployeeYearlyRule(rule, 'dateOfBirth');
      else if (rule.triggerType === 'EMPLOYEE_WORK_ANNIVERSARY') await processEmployeeYearlyRule(rule, 'dateOfJoining');
    }
  } catch (err) {
    console.error('[automation] check failed:', err.message);
  }
}

// Sends via whichever channel(s) the rule specifies, personalizing
// {name} in the text either way. Returns true if at least one channel
// actually succeeded — the sent-log only gets written when this does,
// so a total failure leaves the person eligible for the next check.
function isMessageActiveThisMonth(msg, currentMonth) {
  if (!msg.activeFromMonth || !msg.activeToMonth) return true; // no window set = always eligible
  const { activeFromMonth: from, activeToMonth: to } = msg;
  if (from <= to) return currentMonth >= from && currentMonth <= to; // normal range, e.g. Jan(1) to Jul(7)
  return currentMonth >= from || currentMonth <= to; // wraps across the new year, e.g. Sept(9) to Feb(2)
}

// Picks which message a specific lead should get this time, out of the
// rule's own content (position 0) plus any additionalMessages. Two
// steps: first narrow down to whatever's actually in-season right now
// (seasonal content like intake reminders only matches part of the
// year; evergreen content with no window always matches), then rotate
// through just that eligible set based on how many times this lead has
// already received something under this rule. If literally nothing is
// eligible (shouldn't normally happen, but content could theoretically
// all be seasonal and it's the wrong month for all of it), falls back
// to the rule's own message rather than sending nothing.
function pickMessageForRecipient(rule, sentCountSoFar) {
  const currentMonth = new Date().getMonth() + 1; // JS months are 0-indexed, ours are 1-12
  const allMessages = [
    { subject: rule.subject, body: rule.body, imageUrl: rule.imageUrl, ctaText: rule.ctaText, ctaUrl: rule.ctaUrl, activeFromMonth: null, activeToMonth: null },
    ...(rule.additionalMessages || []).sort((a, b) => a.order - b.order),
  ];
  const eligible = allMessages.filter(m => isMessageActiveThisMonth(m, currentMonth));
  if (eligible.length === 0) return allMessages[0];
  return eligible[sentCountSoFar % eligible.length];
}

async function deliverToRecipient(rule, name, email, phone, message) {
  const msg = message || rule; // callers that don't pass a message (partner/employee rules) keep using the rule's own content, unchanged
  const personalizedBody = msg.body.replace(/\{name\}/g, name || 'there');
  let anySucceeded = false;
  if ((rule.channel === 'EMAIL' || rule.channel === 'BOTH') && email) {
    try {
      await sendMail({
        to: email, subject: msg.subject, body: personalizedBody,
        customHtml: wrapPromotionEmailHtml(msg.subject, personalizedBody, msg.imageUrl, msg.ctaText, msg.ctaUrl),
      });
      anySucceeded = true;
    } catch (err) {
      console.error(`[automation] email failed for rule ${rule.id}:`, err.message);
    }
  }
  if ((rule.channel === 'WHATSAPP' || rule.channel === 'BOTH') && phone) {
    try {
      await sendWhatsApp({ to: phone, message: msg.subject + '\n\n' + personalizedBody, mediaUrl: msg.imageUrl || undefined });
      anySucceeded = true;
    } catch (err) {
      console.error(`[automation] WhatsApp failed for rule ${rule.id}:`, err.message);
    }
  }
  return anySucceeded;
}

async function logSent(ruleId, recipientKey, leadId, userId, period) {
  await prisma.automationSentLog.create({ data: { ruleId, recipientKey, leadId: leadId || null, userId: userId || null, period } });
}

async function processLeadNoResponseRule(rule) {
  const cutoff = new Date(Date.now() - rule.triggerDays * 24 * 60 * 60 * 1000);
  if (!rule.repeatDaily) {
    // Original behavior — a lead gets this email once, ever.
    const candidateLeads = await prisma.lead.findMany({
      where: {
        status: { not: 'CONVERTED' },
        updatedAt: { lt: cutoff },
        OR: [{ contactEmail: { not: null } }, { contactPhone: { not: null } }],
        automationSentLogs: { none: { ruleId: rule.id } },
      },
      take: 200,
    });
    for (const lead of candidateLeads) {
      const delivered = await deliverToRecipient(rule, lead.name, lead.contactEmail, lead.contactPhone);
      if (delivered) await logSent(rule.id, 'LEAD:' + lead.id, lead.id, null, 'once');
    }
    return;
  }
  // repeatDaily — re-sends every day to the same still-unconverted lead.
  // "status: { not: 'CONVERTED' }" below is what makes this stop
  // automatically: the moment a lead converts, this query simply no
  // longer matches them, no separate cutoff logic needed.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const candidateLeads = await prisma.lead.findMany({
    where: {
      status: { not: 'CONVERTED' },
      updatedAt: { lt: cutoff },
      OR: [{ contactEmail: { not: null } }, { contactPhone: { not: null } }],
      automationSentLogs: { none: { ruleId: rule.id, period: todayKey } },
    },
    take: 200,
  });
  for (const lead of candidateLeads) {
    const sentCountSoFar = await prisma.automationSentLog.count({ where: { ruleId: rule.id, leadId: lead.id } });
    const message = pickMessageForRecipient(rule, sentCountSoFar);
    const delivered = await deliverToRecipient(rule, lead.name, lead.contactEmail, lead.contactPhone, message);
    if (delivered) await logSent(rule.id, 'LEAD:' + lead.id, lead.id, null, todayKey);
  }
}

// Channel Partners who haven't had a new lead referred through them in
// N days — a nudge to stay active, not a punishment; framed as a
// re-engagement message the same way the Lead rule is.
async function processPartnerNoReferralRule(rule) {
  const cutoff = new Date(Date.now() - rule.triggerDays * 24 * 60 * 60 * 1000);
  const partners = await prisma.user.findMany({
    where: { role: 'CHANNEL_PARTNER', active: true },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  for (const partner of partners) {
    const recentReferral = await prisma.lead.findFirst({
      where: { assignedEmployeeId: partner.id, dateAdded: { gte: cutoff } },
    });
    if (recentReferral) continue; // they've referred someone recently — rule doesn't apply
    const already = await prisma.automationSentLog.findUnique({
      where: { ruleId_recipientKey_period: { ruleId: rule.id, recipientKey: 'USER:' + partner.id, period: 'once' } },
    });
    if (already) continue;
    const delivered = await deliverToRecipient(rule, partner.fullName, partner.email, partner.phone);
    if (delivered) await logSent(rule.id, 'USER:' + partner.id, null, partner.id, 'once');
  }
}

// Birthdays and work anniversaries — matched on month+day only (the
// year doesn't matter for "is today someone's birthday"), and logged
// per calendar year so the same person is correctly congratulated again
// next year without ever getting two messages in the same year.
async function processEmployeeYearlyRule(rule, dateField) {
  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  const currentYear = String(today.getFullYear());

  const employees = await prisma.user.findMany({
    where: {
      role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER', 'HR', 'FINANCE', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER', 'ADMIN', 'SUPER_ADMIN'] },
      active: true,
      [dateField]: { not: null },
    },
    select: { id: true, fullName: true, email: true, phone: true, [dateField]: true },
  });

  for (const employee of employees) {
    const fieldValue = employee[dateField];
    if (!fieldValue) continue;
    const d = new Date(fieldValue);
    if (d.getMonth() !== todayMonth || d.getDate() !== todayDate) continue;

    const already = await prisma.automationSentLog.findUnique({
      where: { ruleId_recipientKey_period: { ruleId: rule.id, recipientKey: 'USER:' + employee.id, period: currentYear } },
    });
    if (already) continue;

    const delivered = await deliverToRecipient(rule, employee.fullName, employee.email, employee.phone);
    if (delivered) await logSent(rule.id, 'USER:' + employee.id, null, employee.id, currentYear);
  }
}

function startAutomationScheduler() {
  setTimeout(runAutomationCheck, 60 * 1000);
  setInterval(runAutomationCheck, CHECK_INTERVAL_MS);
}

module.exports = { startAutomationScheduler, runAutomationCheck };
