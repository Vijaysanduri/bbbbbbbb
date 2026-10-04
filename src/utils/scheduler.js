const { PrismaClient } = require('@prisma/client');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

const REMINDER_INTERVAL_DAYS = 7;

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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
  }
  if (overdue.length) console.log(`[scheduler] Sent ${overdue.length} payment reminder(s).`);
}

async function runScheduledReminders() {
  try {
    await sendOverdueDocumentReminders();
    await sendOverduePaymentReminders();
  } catch (err) {
    console.error('[scheduler] Reminder run failed:', err.message);
  }
}

module.exports = { runScheduledReminders };
