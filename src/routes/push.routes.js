const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { publicKey, isReady, sendPushToUser } = require('../utils/push');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/push/public-key — the browser needs this to subscribe.
router.get('/public-key', (req, res) => {
  res.json({ enabled: isReady(), publicKey: publicKey() });
});

// POST /api/push/subscribe — save this phone/browser for the signed-in person.
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'Invalid subscription.' });
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: (req.headers['user-agent'] || '').slice(0, 250) },
    create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: (req.headers['user-agent'] || '').slice(0, 250) },
  });
  res.json({ ok: true });
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
  res.json({ ok: true });
});

// POST /api/push/test — sends a test alert to the signed-in person's own devices.
router.post('/test', requireAuth, async (req, res) => {
  await sendPushToUser(req.user.id, { title: 'Dream2Fly alerts are on', body: 'You will now get task and lead updates on this phone.' });
  res.json({ ok: true, enabled: isReady() });
});

module.exports = router;
