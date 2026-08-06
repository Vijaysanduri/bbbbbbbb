const { PrismaClient } = require('@prisma/client');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

const THIRTY_MIN_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------
// 1. Auto-assign leads that have had no real employee owner for 30+
//    minutes — round-robin across active Employees/Counsellors/Managers,
//    picking whoever currently has the fewest active leads.
// ---------------------------------------------------------------------
async function autoAssignStaleLeads() {
  const cutoff = new Date(Date.now() - THIRTY_MIN_MS);
  const staleLeads = await prisma.lead.findMany({
    where: {
      assignedAt: null,
      createdAt: { lte: cutoff },
      status: { not: 'CONVERTED' },
    },
    include: { assignedEmployee: true },
  });
  if (staleLeads.length === 0) return { assigned: 0 };

  const workers = await prisma.user.findMany({
    where: { active: true, role: { in: ['EMPLOYEE', 'COUNSELLOR'] } },
  });
  if (workers.length === 0) return { assigned: 0 };

  // Current active-lead load per worker, so assignment favours whoever's
  // least busy rather than blindly round-robining.
  const loadCounts = await Promise.all(workers.map(async (w) => ({
    worker: w,
    count: await prisma.lead.count({ where: { assignedEmployeeId: w.id, status: { not: 'CONVERTED' } } }),
  })));
  loadCounts.sort((a, b) => a.count - b.count);

  let assigned = 0;
  for (const lead of staleLeads) {
    const pick = loadCounts[assigned % loadCounts.length].worker;
    await prisma.lead.update({
      where: { id: lead.id },
      data: { assignedEmployeeId: pick.id, assignedAt: new Date(), unassignedAlertSent: true },
    });
    await sendMail({
      to: pick.email,
      subject: `Lead auto-assigned to you: ${lead.name}`,
      body: `Hi ${pick.fullName},\n\n"${lead.name}" (${lead.country}, ${lead.service}) has been automatically assigned to you — it had been unassigned for over 30 minutes. Please reach out as soon as possible.\n\nBest,\nDream2Fly`,
    });
    assigned++;
  }
  return { assigned };
}

// ---------------------------------------------------------------------
// 2. Escalate leads that were assigned 30+ minutes ago but still have no
//    logged follow-up — the employee hasn't reached out yet. Notify their
//    reporting manager and Admin/Super Admin, once per lead.
// ---------------------------------------------------------------------
async function escalateUncontactedLeads() {
  const cutoff = new Date(Date.now() - THIRTY_MIN_MS);
  const overdue = await prisma.lead.findMany({
    where: {
      assignedAt: { lte: cutoff },
      contactAlertSent: false,
      status: { not: 'CONVERTED' },
    },
    include: { assignedEmployee: { include: { reportingManager: true } }, followUps: true },
  });

  let escalated = 0;
  for (const lead of overdue) {
    if (lead.followUps.length > 0) {
      // Already contacted — just mark it so we don't keep checking.
      await prisma.lead.update({ where: { id: lead.id }, data: { contactAlertSent: true } });
      continue;
    }
    if (!lead.assignedEmployee) continue;

    const escalationTargets = [];
    if (lead.assignedEmployee.reportingManager) escalationTargets.push(lead.assignedEmployee.reportingManager);
    const leaders = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
    escalationTargets.push(...leaders);

    const seen = new Set();
    for (const target of escalationTargets) {
      if (seen.has(target.email)) continue;
      seen.add(target.email);
      await sendMail({
        to: target.email,
        subject: `No contact yet: ${lead.name} (assigned to ${lead.assignedEmployee.fullName})`,
        body: `Hi ${target.fullName},\n\n"${lead.name}" was assigned to ${lead.assignedEmployee.fullName} over 30 minutes ago and no contact has been logged yet.\n\nPlease follow up.\n\nBest,\nDream2Fly`,
      });
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { contactAlertSent: true } });
    escalated++;
  }
  return { escalated };
}

// ---------------------------------------------------------------------
// 3. Daily standup digest — leads and tasks with no activity logged
//    today, sent once per day to Admin/Super Admin/Manager.
// ---------------------------------------------------------------------
async function sendDailyStandupDigestIfDue() {
  const now = new Date();
  // Fires once between 09:00 and 09:09 server time, on first check that
  // day — simple, no separate cron dependency needed.
  if (now.getHours() !== 9) return { sent: false };

  const todayStr = now.toISOString().slice(0, 10);
  const existing = await prisma.dailyDigestLog.findUnique({ where: { digestDate: todayStr } });
  if (existing) return { sent: false };

  const todayStart = new Date(todayStr + 'T00:00:00.000Z');

  const activeLeads = await prisma.lead.findMany({
    where: { status: { not: 'CONVERTED' } },
    include: { followUps: { orderBy: { date: 'desc' }, take: 1 }, comments: { orderBy: { createdAt: 'desc' }, take: 1 }, assignedEmployee: true },
  });
  const staleLeads = activeLeads.filter(l => {
    const lastActivity = [l.followUps[0]?.date, l.comments[0]?.createdAt].filter(Boolean).sort().pop();
    return !lastActivity || new Date(lastActivity) < todayStart;
  });

  const activeTasks = await prisma.task.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    include: { comments: { orderBy: { createdAt: 'desc' }, take: 1 }, assignedEmployee: true },
  });
  const staleTasks = activeTasks.filter(t => {
    const lastActivity = t.comments[0]?.createdAt;
    return !lastActivity || new Date(lastActivity) < todayStart;
  });

  if (staleLeads.length === 0 && staleTasks.length === 0) {
    await prisma.dailyDigestLog.create({ data: { digestDate: todayStr } });
    return { sent: false, empty: true };
  }

  const leadLines = staleLeads.map(l => `- ${l.name} (${l.assignedEmployee ? l.assignedEmployee.fullName : 'unassigned'}) — no update today`).join('\n');
  const taskLines = staleTasks.map(t => `- ${t.related} (${t.assignedEmployee ? t.assignedEmployee.fullName : 'unassigned'}) — no update today`).join('\n');

  const leaders = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'MANAGER'] }, active: true } });
  for (const leader of leaders) {
    await sendMail({
      to: leader.email,
      subject: `Daily standup — ${staleLeads.length + staleTasks.length} item(s) with no progress logged`,
      body: `Hi ${leader.fullName},\n\nFor today's standup — these leads/tasks have had no update logged yet today:\n\nLEADS:\n${leadLines || '(none)'}\n\nTASKS:\n${taskLines || '(none)'}\n\nBest,\nDream2Fly`,
    });
  }
  await prisma.dailyDigestLog.create({ data: { digestDate: todayStr } });
  return { sent: true, count: staleLeads.length + staleTasks.length };
}

// ---------------------------------------------------------------------
// 4. Deactivate accounts whose approved resignation's last working day
//    has passed — so Admin doesn't have to remember to do this manually.
//    Their historical data (payslips, attendance, documents) all stays
//    intact; only login access and "active employee" list membership change.
// ---------------------------------------------------------------------
async function deactivateExpiredResignations() {
  const today = new Date();
  const dueResignations = await prisma.resignation.findMany({
    where: { status: 'APPROVED', actualLastWorkingDay: { lte: today }, deactivatedAt: null },
    include: { user: true },
  });
  for (const r of dueResignations) {
    await prisma.user.update({ where: { id: r.userId }, data: { active: false } });
    await prisma.resignation.update({ where: { id: r.id }, data: { deactivatedAt: new Date() } });
  }
  return { deactivated: dueResignations.length };
}

async function runSlaChecks() {
  try {
    await autoAssignStaleLeads();
    await escalateUncontactedLeads();
    await sendDailyStandupDigestIfDue();
    await deactivateExpiredResignations();
  } catch (err) {
    console.error('SLA scheduler error:', err.message);
  }
}

module.exports = { runSlaChecks, autoAssignStaleLeads, escalateUncontactedLeads, sendDailyStandupDigestIfDue, deactivateExpiredResignations };
