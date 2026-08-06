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

module.exports = { createNotification };
