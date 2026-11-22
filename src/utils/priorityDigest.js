// Evening "Today's priorities" email — one mail per employee listing
// their open tasks ordered by priority/due date, each with the latest
// comment. ADDITIVE: reads only, no schema change. Dedup reuses
// DailyDigestLog with a "PRIORITY-" prefixed key.
const { PrismaClient } = require('@prisma/client');
const { sendMail } = require('./mailer');
const prisma = new PrismaClient();

const SEND_HOUR = 9; // 9 AM server time (before staff log in)
const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

async function buildForEmployee(user, now) {
  const tasks = await prisma.task.findMany({
    where: { assignedEmployeeId: user.id, hidden: false, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'PENDING_PARTNER', 'PENDING_UNIVERSITY'] } },
    include: { comments: { where: { channel: 'INTERNAL', isSystem: false }, orderBy: { createdAt: 'desc' }, take: 1, include: { author: true } } },
  });
  tasks.sort((a, b) => (RANK[a.priority] - RANK[b.priority]) || (new Date(a.due) - new Date(b.due)));
  return tasks;
}

async function sendPriorityDigestIfDue(force = false) {
  const now = new Date();
  if (!force && now.getHours() !== SEND_HOUR) return { sent: false };
  const key = 'PRIORITY-' + now.toISOString().slice(0, 10);
  if (!force) {
    if (await prisma.dailyDigestLog.findUnique({ where: { digestDate: key } })) return { sent: false };
    await prisma.dailyDigestLog.create({ data: { digestDate: key } }); // claim first so a restart can't double-send
  }
  const users = await prisma.user.findMany({ where: { role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'] }, active: true } });
  let sent = 0;
  for (const u of users) {
    const tasks = await buildForEmployee(u, now);
    if (!tasks.length) continue;
    const lines = tasks.map((t, i) => {
      const c = t.comments[0];
      const late = new Date(t.due) < now ? ' [OVERDUE]' : '';
      return `${i + 1}. [${t.priority}] TSK-${String(t.taskNumber).padStart(4, '0')} ${t.related} — ${t.title} (due ${fmt(t.due)})${late}\n   Latest comment: ${c ? `${(c.author && c.author.fullName) || 'Team'}: ${c.text.slice(0, 160)}` : 'none'}`;
    }).join('\n\n');
    const rows = tasks.map((t, i) => {
      const c = t.comments[0];
      const col = t.priority === 'HIGH' ? '#c62828' : t.priority === 'MEDIUM' ? '#ef6c00' : '#2e7d32';
      return `<tr><td>${i + 1}</td><td style="color:${col};font-weight:bold">${t.priority}</td><td>TSK-${String(t.taskNumber).padStart(4, '0')}<br>${esc(t.related)}<br><small>${esc(t.title)}</small></td><td>${fmt(t.due)}${new Date(t.due) < now ? '<br><b style="color:#c62828">OVERDUE</b>' : ''}</td><td>${c ? esc(((c.author && c.author.fullName) || 'Team') + ': ' + c.text.slice(0, 160)) : '—'}</td></tr>`;
    }).join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px"><p>Hi ${esc(u.fullName)},</p><p>Your priorities for today, most important first:</p><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ddd"><tr style="background:#0b1f4d;color:#fff"><th>#</th><th>Priority</th><th>Task</th><th>Due</th><th>Latest comment</th></tr>${rows}</table><p>Please start from #1.<br>Best,<br>Dream2Fly</p></div>`;
    try {
      await sendMail({ to: u.email, subject: `Today's priorities — ${tasks.length} task(s)`, body: `Hi ${u.fullName},\n\nYour priorities for today, most important first:\n\n${lines}\n\nPlease start from #1.\nBest,\nDream2Fly`, customHtml: html });
      sent++;
    } catch (e) { console.error('priority digest mail failed for', u.email, e.message); }
  }
  return { sent: true, count: sent };
}

module.exports = { sendPriorityDigestIfDue };
