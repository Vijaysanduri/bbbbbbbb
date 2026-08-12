const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

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

// POST /api/activity-log/export — any signed-in staff member. CSV/bulk
// exports (Attendance, Payments, and anywhere else this gets added)
// happen entirely in the browser — the export button just turns
// already-loaded data into a file client-side, so without this call
// there is zero server-side record that an export ever happened. This
// exists specifically so "someone exported 400 payment records to CSV"
// shows up in the Audit Log the same way any other sensitive action
// does — the exact kind of bulk data movement worth being able to see
// after the fact, not just changes to individual records.
router.post('/export', requireAuth, async (req, res) => {
  const { exportType, recordCount } = req.body;
  if (!exportType) return res.status(400).json({ error: 'exportType is required.' });
  await logActivity(`${req.user.fullName} exported ${recordCount != null ? recordCount + ' ' : ''}${exportType} record(s) to CSV.`, req.user.id);
  res.status(201).json({ success: true });
});

module.exports = router;
