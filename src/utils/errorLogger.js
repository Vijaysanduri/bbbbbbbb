const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Writes an error to the database, in addition to whatever else already
// happens with it (console.error, the response sent back, etc.). Never
// lets a logging failure itself crash the request — if the database
// write fails, we fall back to console.error and move on, same as
// before this existed.
async function logError(err, req) {
  try {
    await prisma.errorLog.create({
      data: {
        message: (err && err.message) || String(err) || 'Unknown error',
        stack: (err && err.stack) || null,
        method: req ? req.method : null,
        path: req ? req.originalUrl : null,
        statusCode: (err && err.statusCode) || null,
        userId: (req && req.user && req.user.id) || null,
      },
    });
  } catch (loggingErr) {
    console.error('[errorLogger] Could not write to ErrorLog table:', loggingErr.message);
    console.error('[errorLogger] Original error was:', err);
  }
}

module.exports = { logError };
