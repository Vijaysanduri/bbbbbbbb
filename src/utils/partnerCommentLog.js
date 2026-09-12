// Shared by every file that needs to log an automatic, system-generated
// entry to a Channel Partner's comment thread (Agreement sent,
// Certificate sent, reminder sent, document approved/rejected, etc.) -
// one place for this so the same isSystem/channel convention stays
// consistent everywhere it's used, rather than each caller building
// its own Comment.create() call slightly differently.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function logPartnerComment(partnerId, text, authorId) {
  try {
    await prisma.comment.create({
      data: { partnerId, text, isSystem: true, channel: 'INTERNAL', authorId: authorId || null },
    });
  } catch (err) {
    // A logging failure should never take down the actual action it's
    // describing (the email that was sent, the approval that just
    // happened) - just note it and move on.
    console.error('[partner-comment-log] Failed to log:', text, '-', err.message);
  }
}

module.exports = { logPartnerComment };
