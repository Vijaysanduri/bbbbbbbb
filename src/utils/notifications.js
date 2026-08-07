const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Creates the in-app alert that populates the bell icon — separate from
// email, and much lighter weight, so this can be called liberally
// wherever something notification-worthy happens.
async function createNotification(userId, title, body, type, link) {
  try {
    await prisma.notification.create({
      data: { userId, title, body: body || null, type: type || 'GENERAL', link: link || null },
    });
  } catch (e) {
    // Never let a notification failure break the actual request it's attached to.
    console.error('Could not create notification:', e.message);
  }
}

// Fans out an in-app bell notification to everyone who should stay in the
// loop on a lead or task: the person it's currently assigned to, that
// person's reporting manager, and every active Admin/Super Admin —
// regardless of who's actually assigned. Excludes the person who just
// made the change, since they don't need to be told about their own
// action. Used for both comments and status/stage changes, on both
// leads and tasks, so "who gets notified" stays consistent everywhere
// instead of each route reimplementing its own recipient list.
async function notifyRecordWatchers({ assignedEmployeeId, actorId, title, body, type, link }) {
  const recipientIds = new Set();
  if (assignedEmployeeId) {
    recipientIds.add(assignedEmployeeId);
    const assignee = await prisma.user.findUnique({ where: { id: assignedEmployeeId }, select: { reportingManagerId: true } });
    if (assignee && assignee.reportingManagerId) recipientIds.add(assignee.reportingManagerId);
  }
  const leadership = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true }, select: { id: true } });
  leadership.forEach(u => recipientIds.add(u.id));
  if (actorId) recipientIds.delete(actorId);
  await Promise.all([...recipientIds].map(id => createNotification(id, title, body, type, link)));
}

module.exports = { createNotification, notifyRecordWatchers };
