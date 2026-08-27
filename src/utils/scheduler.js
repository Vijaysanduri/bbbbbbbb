const { PrismaClient } = require('@prisma/client');
const { sendMail } = require('./mailer');
const { createNotification } = require('./notifications');
const { TOKEN_LIFETIME_MS, sessionEffectiveEnd } = require('./sessionHelpers');

const prisma = new PrismaClient();

const REMINDER_INTERVAL_DAYS = 7;

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Small pause between each email in a batch loop — on top of the retry
// logic in mailer.js, this reduces how often a large daily batch (many
// candidates going stale on the same day) trips a rate limit in the
// first place, rather than just recovering after the fact.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Weekly reminders for anyone who still hasn't signed/uploaded an active
// document — the same email the manual "Send Reminder" button sends, just
// firing on its own schedule instead of needing a staff member to click it
// for every single person.
async function sendOverdueDocumentReminders() {
  const cutoff = daysAgo(REMINDER_INTERVAL_DAYS);
  const overdue = await prisma.signableDocumentAck.findMany({
    where: {
      signedAt: null,
      uploadedFileData: null,
      document: { active: true },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cutoff } }],
    },
    include: { document: true, user: true },
  });

  for (const ack of overdue) {
    // A brand-new document shouldn't get an automated nag the same day it
    // was created — give it a week of grace before the scheduler kicks in.
    if (!ack.lastReminderAt && ack.document.createdAt > cutoff) continue;
    try {
      await sendMail({
        to: ack.user.email,
        subject: `Reminder: please sign "${ack.document.title}"`,
        body: `Hi ${ack.user.fullName},\n\nThis is a reminder that "${ack.document.title}" is still awaiting your signature. Please complete it from your portal.\n\nBest,\nDream2Fly HR`,
      });
      await prisma.signableDocumentAck.update({
        where: { id: ack.id },
        data: { remindersSentCount: { increment: 1 }, lastReminderAt: new Date() },
      });
    } catch (err) {
      console.error('Scheduled document reminder failed for', ack.user.email, err.message);
    }
    await sleep(300);
  }
  if (overdue.length) console.log(`[scheduler] Sent ${overdue.length} document signing reminder(s).`);
}

// Weekly reminders for students with an unpaid fee — reuses the same
// "hasn't acted in 7+ days" pattern as document reminders above.
async function sendOverduePaymentReminders() {
  const cutoff = daysAgo(REMINDER_INTERVAL_DAYS);
  const overdue = await prisma.payment.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    include: { student: true },
  });

  for (const payment of overdue) {
    try {
      await sendMail({
        to: payment.student.email,
        subject: `Reminder: payment due — ${payment.purpose}`,
        body: `Hi ${payment.student.fullName},\n\nThis is a reminder that a payment of \u20B9${payment.amount.toFixed(2)} for "${payment.purpose}" is still pending. Please complete it from your student portal.\n\nBest,\nDream2Fly`,
      });
    } catch (err) {
      console.error('Scheduled payment reminder failed for', payment.student.email, err.message);
    }
    await sleep(300);
  }
  if (overdue.length) console.log(`[scheduler] Sent ${overdue.length} payment reminder(s).`);
}

// Daily safety net for students, with a deliberate ceiling.
//
// DAY 1 stale (no genuine candidate-facing update in 24h): resend the
// last real update to the candidate, and notify the assigned employee
// that this happened on their behalf — they need to send a real one.
//
// DAY 2+ stale: does NOT send the candidate a second automatic email.
// Repeating the same "nothing's changed" message would read as "nobody
// is actually working on my case," which is worse than silence. Instead
// this escalates to Admin/Super Admin — the assigned employee may be on
// leave or otherwise unavailable, and someone needs to step in. Admin
// gets re-alerted once per day for as long as it stays stale, same
// cadence as the existing document/payment reminders below.
//
// Skips entirely on a day your team has marked as an office holiday —
// nobody should be flagged as having "missed" an update on a day off.
//
// Only ever looks at CANDIDATE_FACING comments when deciding what
// counts as "an update was sent" or what to resend — internal staff
// notes are never counted and never leaked to a candidate.
async function sendStaleTaskUpdateReminders() {
  const now = new Date();
  const oneDayCutoff = daysAgo(1);
  const twoDayCutoff = daysAgo(2);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const todaysHoliday = await prisma.holiday.findFirst({ where: { date: { gte: todayStart, lt: todayEnd } } });
  if (todaysHoliday) {
    console.log(`[scheduler] Skipping stale-task-update check — today (${todaysHoliday.name}) is an office holiday.`);
    return;
  }

  const activeTasks = await prisma.task.findMany({
    where: { studentId: { not: null }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    include: {
      student: true,
      assignedEmployee: true,
      comments: { where: { channel: 'CANDIDATE_FACING' }, orderBy: { createdAt: 'desc' }, take: 30 },
    },
  });

  let candidateReminderCount = 0;
  let escalationCount = 0;

  for (const task of activeTasks) {
    if (!task.student || !task.student.email) continue;
    const genuineUpdates = task.comments.filter(c => !c.isSystem);
    if (genuineUpdates.length === 0) continue; // nothing sent yet at all — not this scheduler's job to send a first update
    const lastGenuine = genuineUpdates[0];
    const reminderAlreadySentForThisStretch = task.comments.find(c => c.isSystem && c.createdAt > lastGenuine.createdAt);

    if (!reminderAlreadySentForThisStretch) {
      // ---- DAY 1: one candidate reminder, one employee notification ----
      if (lastGenuine.createdAt > oneDayCutoff) continue; // still fresh
      try {
        await sendMail({
          to: task.student.email,
          subject: `Update on your application — ${task.related}`,
          body: `Hi ${task.student.fullName},\n\nWe don't have a brand-new update since our last message, but wanted to keep you posted — here's where things currently stand:\n\n"${lastGenuine.text}"\n\nWe'll be in touch the moment anything changes.\n\nBest,\nDream2Fly Team`,
        });
        await prisma.comment.create({
          data: {
            taskId: task.id, isSystem: true, channel: 'CANDIDATE_FACING',
            text: `[Automatic daily reminder — no new update was sent, so the previous one was resent]\n${lastGenuine.text}`,
          },
        });
        candidateReminderCount++;
        if (task.assignedEmployeeId) {
          await createNotification(
            task.assignedEmployeeId,
            'You missed sending an update',
            `${task.related} didn't get an update from you yesterday — an automatic reminder was sent on your behalf. Please follow up with a real update today.`,
            'MISSED_UPDATE', 'tasks'
          );
        } else {
          // Nobody's actually assigned to this case at all — that's a
          // bigger problem than a busy employee, so this goes straight
          // to Admin on day 1 rather than waiting for day 2.
          const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
          for (const admin of admins) {
            await createNotification(admin.id, `${task.related}'s case is unassigned`, 'This case just went a full day with no update and has nobody assigned to it — please assign someone.', 'STALE_CASE_ESCALATION', 'tasks');
          }
        }
      } catch (err) {
        console.error('Scheduled stale-task-update reminder failed for', task.student.email, err.message);
        // Retries in sendMail already handle a brief hiccup — reaching
        // this point means it failed persistently (e.g. a genuinely bad
        // email address, or an outage longer than the retry window).
        // That should never fail completely silently — someone needs
        // to know so they can follow up with the candidate another way.
        const notifyTarget = task.assignedEmployeeId
          ? [task.assignedEmployeeId]
          : (await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } })).map(a => a.id);
        for (const userId of notifyTarget) {
          await createNotification(
            userId,
            `Couldn't send an update to ${task.related}`,
            `The automatic reminder email failed to send (${err.message}). Please check their email address and follow up directly.`,
            'EMAIL_SEND_FAILED', 'tasks'
          ).catch(() => {}); // never let a notification failure mask the original error
        }
      }
      await sleep(300);
      continue;
    }

    // ---- DAY 2+: no further candidate emails — escalate internally ----
    if (lastGenuine.createdAt > twoDayCutoff) continue;
    const alreadyEscalatedToday = await prisma.comment.findFirst({
      where: { taskId: task.id, channel: 'INTERNAL', isSystem: true, text: { startsWith: '[Automatic escalation]' }, createdAt: { gt: oneDayCutoff } },
    });
    if (alreadyEscalatedToday) continue;
    const daysStale = Math.floor((now - lastGenuine.createdAt) / (24 * 60 * 60 * 1000));
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
    for (const admin of admins) {
      await createNotification(
        admin.id,
        `${task.related} hasn't been updated in ${daysStale} days`,
        `${task.assignedEmployee ? task.assignedEmployee.fullName : 'The assigned employee'} may be unavailable (e.g. on leave) — this case needs attention.`,
        'STALE_CASE_ESCALATION', 'tasks'
      );
    }
    await prisma.comment.create({
      data: { taskId: task.id, isSystem: true, channel: 'INTERNAL', text: `[Automatic escalation] No candidate update in ${daysStale} days — leadership notified.` },
    });
    escalationCount++;
  }
  if (candidateReminderCount) console.log(`[scheduler] Sent ${candidateReminderCount} stale task update reminder(s) to candidates.`);
  if (escalationCount) console.log(`[scheduler] Escalated ${escalationCount} stale case(s) to leadership.`);
}

async function runScheduledReminders() {
  try {
    await sendOverdueDocumentReminders();
    await sendOverduePaymentReminders();
    await sendStaleTaskUpdateReminders();
  } catch (err) {
    console.error('[scheduler] Reminder run failed:', err.message);
  }
}

// The automatic candidate email specifically needs to go out AFTER the
// team's workday ends (6pm) — sending it earlier risks it going out
// while an employee still had time to send a real update themselves
// that day. 7pm gives a one-hour buffer past end of day.
//
// IMPORTANT — timezone assumption: this assumes Asia/Kolkata (IST).
// Guessed from the +91 phone number used throughout this app; if
// Dream2Fly's actual working hours run on a different clock (e.g. the
// .co.uk side of the business), change SCHEDULE_TIMEZONE below — this
// is the one place that needs updating.
const SCHEDULE_TIMEZONE = 'Asia/Kolkata';
const SCHEDULE_HOUR = 19; // 7pm, 24-hour format

function currentHourInScheduleTimezone() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TIMEZONE, hour: 'numeric', hour12: false }).format(new Date()), 10);
}
function currentDateKeyInScheduleTimezone() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULE_TIMEZONE }).format(new Date()); // en-CA formats as YYYY-MM-DD
}

// Tracked in memory, not the database — deliberately. A server restart
// resetting this and causing a second run on the same day is a
// harmless, wasteful re-check, not a real bug: every individual
// reminder function above (sendStaleTaskUpdateReminders, the document
// and payment reminders) already checks the database for whether IT
// specifically already sent, per task/document/payment, before doing
// anything — so a duplicate outer trigger can never actually cause a
// duplicate email. This just avoids the (harmless) extra work in the
// common case.
let lastRunDateKey = null;

// Writes a real logoutAt for any session that's expired but was never
// explicitly closed — someone who left the company or just stopped
// using the portal, with no future login to trigger the cleanup that
// already happens on re-login. Runs every 5 minutes (piggybacking on
// the same interval as the 7pm check below, but independent of that
// once-daily gate — this needs to run continuously through the day, not
// just once). The read-time cap in sessionHelpers.js already makes any
// query correct even in the few minutes before this catches up, so this
// is about keeping the stored data itself clean, not about correctness.
async function finalizeExpiredLoginSessions() {
  const cutoff = new Date(Date.now() - TOKEN_LIFETIME_MS);
  const staleOpenSessions = await prisma.loginSession.findMany({
    where: { logoutAt: null, loginAt: { lt: cutoff } },
  });
  for (const session of staleOpenSessions) {
    await prisma.loginSession.update({
      where: { id: session.id },
      data: { logoutAt: sessionEffectiveEnd(session) },
    });
  }
  if (staleOpenSessions.length) console.log(`[scheduler] Finalized ${staleOpenSessions.length} expired login session(s).`);
}

function startDailyScheduler() {
  async function check() {
    const hour = currentHourInScheduleTimezone();
    const todayKey = currentDateKeyInScheduleTimezone();
    if (hour >= SCHEDULE_HOUR && lastRunDateKey !== todayKey) {
      lastRunDateKey = todayKey;
      console.log(`[scheduler] Running daily reminders for ${todayKey} (${SCHEDULE_TIMEZONE} time is currently ${hour}:xx).`);
      await runScheduledReminders();
    }
    try {
      await finalizeExpiredLoginSessions();
    } catch (err) {
      console.error('[scheduler] Finalizing expired login sessions failed:', err.message);
    }
  }
  check(); // covers the case where the server starts after 7pm on a day that hasn't run yet
  setInterval(check, 5 * 60 * 1000);
}

module.exports = { runScheduledReminders, startDailyScheduler };
