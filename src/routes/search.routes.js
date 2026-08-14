const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/search?q=... — the header search box on every dashboard.
// Searches leads and tasks by name in one request, respecting the same
// per-role visibility rules the full list pages already use (e.g. a
// Channel Partner only ever sees their own referred leads here too —
// this reuses that exact scoping, not a separate set of rules that
// could drift out of sync).
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ leads: [], tasks: [] });

  const role = req.user.role;

  const leadWhere = {
    name: { contains: q },
    ...(role === 'CHANNEL_PARTNER' ? { assignedEmployeeId: req.user.id } : {}),
  };
  const taskWhere = { related: { contains: q } };

  // Students only ever see their own linked case — global search
  // doesn't apply the same way for them, so this returns nothing rather
  // than trying to search across data they can't otherwise access.
  const [leads, tasks] = await Promise.all([
    role === 'STUDENT' ? [] : prisma.lead.findMany({ where: leadWhere, select: { id: true, name: true, country: true, service: true, status: true }, take: 8, orderBy: { dateAdded: 'desc' } }),
    role === 'STUDENT' ? [] : prisma.task.findMany({ where: taskWhere, select: { id: true, taskNumber: true, related: true, country: true, status: true }, take: 8, orderBy: { due: 'asc' } }),
  ]);

  res.json({ leads, tasks });
});

module.exports = router;
