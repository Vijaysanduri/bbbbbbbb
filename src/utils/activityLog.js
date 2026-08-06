const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  try {
    await prisma.activityLog.create({ data: { text, actorId: actorId || null } });
  } catch (e) {
    // Never let a logging failure break the actual request.
    console.error('Could not write activity log:', e.message);
  }
}

module.exports = { logActivity };
