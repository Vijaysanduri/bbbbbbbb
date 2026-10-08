const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Phone/browser push alerts (Web Push). Completely optional: if the VAPID
// keys aren't set in the environment, or the web-push package is missing,
// every function here quietly does nothing and nothing else breaks.
let webpush = null;
let ready = false;
try {
  webpush = require('web-push');
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@dream2fly.co.uk', pub, priv);
    ready = true;
  } else {
    console.warn('[push] VAPID keys not set — phone push alerts disabled.');
  }
} catch (e) {
  console.warn('[push] web-push not available — phone push alerts disabled:', e.message);
}

function isReady() { return ready; }
function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }

async function sendPushToUser(userId, { title, body, link }) {
  if (!ready) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body: body || '', link: link || null, tag: 'd2f-' + Date.now() });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        // 404/410 = phone unsubscribed or app uninstalled: clean up the dead row.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error('[push] send failed:', err.statusCode || '', err.message);
        }
      }
    }));
  } catch (e) {
    console.error('[push] sendPushToUser failed:', e.message);
  }
}

module.exports = { sendPushToUser, isReady, publicKey };
