const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/activity-log?limit=200 — Admin/Super Admin only. Most recent
// activity first — every "who did what, when" moment already being logged
// across Leads, Tasks, Leaves, Resignations, Expenses, Assets, and
// permission changes, in one place instead of scattered across each
// feature's own history.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const entries = await prisma.activityLog.findMany({
    include: { actor: { select: { fullName: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(entries);
});

module.exports = router;
