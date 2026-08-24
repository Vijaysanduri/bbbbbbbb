const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/error-logs?resolved=&search=&limit= — Admin/Super Admin only.
// Most recent first. This is the whole point of this feature: seeing
// what's actually breaking without needing Railway Console access.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { resolved, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 100, 300);
  const where = {
    ...(resolved === 'true' ? { resolved: true } : resolved === 'false' ? { resolved: false } : {}),
    ...(search ? { OR: [{ message: { contains: search } }, { path: { contains: search } }] } : {}),
  };
  const logs = await prisma.errorLog.findMany({
    where,
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(logs);
});

// PATCH /api/error-logs/:id/resolve — mark an error as looked at/fixed,
// so the list can be worked through like an inbox rather than staying a
// permanently-growing wall of the same few issues.
router.patch('/:id/resolve', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const updated = await prisma.errorLog.update({ where: { id: req.params.id }, data: { resolved: true } });
  res.json(updated);
});

// DELETE /api/error-logs/:id — Admin/Super Admin only, for clearing out
// noise (e.g. a one-off network blip that isn't worth keeping around).
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.errorLog.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
