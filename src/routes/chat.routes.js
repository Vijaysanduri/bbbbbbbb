const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'HR', 'EMPLOYEE', 'COUNSELLOR'];

// Ensures the singleton "Company Chat" group channel exists, and that the
// requesting user is a member of it. Called lazily on every /channels
// request rather than at signup, so it also catches anyone who existed
// before this feature was built.
async function ensureCompanyChatMembership(userId) {
  let companyChannel = await prisma.chatChannel.findFirst({ where: { type: 'GROUP' } });
  if (!companyChannel) {
    companyChannel = await prisma.chatChannel.create({ data: { type: 'GROUP', name: 'Company Chat' } });
  }
  const existingMembership = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId: companyChannel.id, userId } },
  });
  if (!existingMembership) {
    await prisma.chatChannelMember.create({ data: { channelId: companyChannel.id, userId } });
  }
  return companyChannel;
}

// GET /api/chat/directory — every other active staff member, to start a DM with.
router.get('/directory', requireAuth, async (req, res) => {
  if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not available for this role.' });
  const people = await prisma.user.findMany({
    where: { active: true, role: { in: STAFF_ROLES }, id: { not: req.user.id } },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(people);
});

// GET /api/chat/channels — every channel the signed-in user belongs to,
// with an unread count and a preview of the last message.
router.get('/channels', requireAuth, async (req, res) => {
  if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not available for this role.' });
  await ensureCompanyChatMembership(req.user.id);

  const memberships = await prisma.chatChannelMember.findMany({
    where: { userId: req.user.id },
    include: {
      channel: {
        include: {
          members: { include: { user: { select: { id: true, fullName: true } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { fullName: true } } } },
        },
      },
    },
  });

  const channels = await Promise.all(memberships.map(async (m) => {
    const otherMember = m.channel.type === 'DIRECT' ? m.channel.members.find(x => x.userId !== req.user.id) : null;
    const unreadCount = await prisma.chatMessage.count({
      where: {
        channelId: m.channelId,
        senderId: { not: req.user.id },
        createdAt: { gt: m.lastReadAt || new Date(0) },
      },
    });
    return {
      id: m.channel.id,
      type: m.channel.type,
      name: m.channel.type === 'GROUP' ? m.channel.name : (otherMember ? otherMember.user.fullName : 'Direct Message'),
      lastMessage: m.channel.messages[0] ? { text: m.channel.messages[0].text, sender: m.channel.messages[0].sender.fullName, createdAt: m.channel.messages[0].createdAt } : null,
      unreadCount,
    };
  }));

  channels.sort((a, b) => {
    if (a.type === 'GROUP') return -1;
    if (b.type === 'GROUP') return 1;
    const aTime = a.lastMessage ? a.lastMessage.createdAt : 0;
    const bTime = b.lastMessage ? b.lastMessage.createdAt : 0;
    return new Date(bTime) - new Date(aTime);
  });
  res.json(channels);
});

// POST /api/chat/channels/dm — get-or-create a 1:1 channel with someone.
// Body: { userId }
router.post('/channels/dm', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot start a DM with yourself.' });

  // Look for an existing DIRECT channel containing exactly these two people.
  const myDirectChannels = await prisma.chatChannelMember.findMany({
    where: { userId: req.user.id, channel: { type: 'DIRECT' } },
    select: { channelId: true },
  });
  const theirMembership = await prisma.chatChannelMember.findFirst({
    where: { userId, channelId: { in: myDirectChannels.map(c => c.channelId) } },
  });
  if (theirMembership) return res.json({ id: theirMembership.channelId });

  const channel = await prisma.chatChannel.create({
    data: {
      type: 'DIRECT',
      members: { create: [{ userId: req.user.id }, { userId }] },
    },
  });
  res.status(201).json({ id: channel.id });
});

// GET /api/chat/channels/:id/messages — the most recent 100 messages, and
// marks the channel read for this user as of now.
router.get('/channels/:id/messages', requireAuth, async (req, res) => {
  const membership = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId: req.params.id, userId: req.user.id } },
  });
  if (!membership) return res.status(403).json({ error: 'Not a member of this channel.' });

  const messages = await prisma.chatMessage.findMany({
    where: { channelId: req.params.id },
    include: { sender: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  await prisma.chatChannelMember.update({ where: { id: membership.id }, data: { lastReadAt: new Date() } });
  res.json(messages);
});

// GET /api/chat/channels/:id/messages/since?since=ISO_TIMESTAMP — for
// polling while a channel is open, instead of re-fetching everything.
router.get('/channels/:id/messages/since', requireAuth, async (req, res) => {
  const membership = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId: req.params.id, userId: req.user.id } },
  });
  if (!membership) return res.status(403).json({ error: 'Not a member of this channel.' });

  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 60 * 1000);
  const messages = await prisma.chatMessage.findMany({
    where: { channelId: req.params.id, createdAt: { gt: since } },
    include: { sender: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  await prisma.chatChannelMember.update({ where: { id: membership.id }, data: { lastReadAt: new Date() } });
  res.json({ checkedAt: new Date().toISOString(), messages });
});

// POST /api/chat/channels/:id/messages — Body: { text, attachmentUrl, attachmentName }
router.post('/channels/:id/messages', requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentName } = req.body;
  if (!text && !attachmentUrl) return res.status(400).json({ error: 'text or an attachment is required.' });
  const membership = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId: req.params.id, userId: req.user.id } },
  });
  if (!membership) return res.status(403).json({ error: 'Not a member of this channel.' });

  const message = await prisma.chatMessage.create({
    data: { channelId: req.params.id, senderId: req.user.id, text: text || '', attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null },
    include: { sender: { select: { id: true, fullName: true } } },
  });
  await prisma.chatChannelMember.update({ where: { id: membership.id }, data: { lastReadAt: new Date() } });
  res.status(201).json(message);
});

// GET /api/chat/unread-total — total unread messages across every
// channel, for a small badge on the nav item.
router.get('/unread-total', requireAuth, async (req, res) => {
  if (!STAFF_ROLES.includes(req.user.role)) return res.json({ total: 0 });
  await ensureCompanyChatMembership(req.user.id);
  const memberships = await prisma.chatChannelMember.findMany({ where: { userId: req.user.id } });
  let total = 0;
  for (const m of memberships) {
    total += await prisma.chatMessage.count({
      where: { channelId: m.channelId, senderId: { not: req.user.id }, createdAt: { gt: m.lastReadAt || new Date(0) } },
    });
  }
  res.json({ total });
});

module.exports = router;
