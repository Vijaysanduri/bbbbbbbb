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
    const activeRules = await prisma.automationRule.findMany({ where: { active: true } });
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
async function deliverToRecipient(rule, name, email, phone) {
  const personalizedBody = rule.body.replace(/\{name\}/g, name || 'there');
  let anySucceeded = false;
  if ((rule.channel === 'EMAIL' || rule.channel === 'BOTH') && email) {
    try {
      await sendMail({
        to: email, subject: rule.subject, body: personalizedBody,
        customHtml: wrapPromotionEmailHtml(rule.subject, personalizedBody, rule.imageUrl, rule.ctaText, rule.ctaUrl),
      });
      anySucceeded = true;
    } catch (err) {
      console.error(`[automation] email failed for rule ${rule.id}:`, err.message);
    }
  }
  if ((rule.channel === 'WHATSAPP' || rule.channel === 'BOTH') && phone) {
    try {
      await sendWhatsApp({ to: phone, message: rule.subject + '\n\n' + personalizedBody, mediaUrl: rule.imageUrl || undefined });
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
