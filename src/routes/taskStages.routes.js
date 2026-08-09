const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/task-stages — any signed-in staff member. Powers the Stage
// dropdown in the Task modal. Only active stages by default.
router.get('/', requireAuth, async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const stages = await prisma.taskStageOption.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { order: 'asc' },
  });
  res.json(stages);
});

// POST /api/task-stages — Admin/Super Admin only. Body: { name }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'A stage name is required.' });
  const existing = await prisma.taskStageOption.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'A stage with this exact name already exists.' });
  const maxOrder = await prisma.taskStageOption.aggregate({ _max: { order: true } });
  const stage = await prisma.taskStageOption.create({
    data: { name: name.trim(), order: (maxOrder._max.order || 0) + 1 },
  });
  await logActivity(`${req.user.fullName} added the task stage "${stage.name}".`, req.user.id);
  res.status(201).json(stage);
});

// PATCH /api/task-stages/:id — Admin/Super Admin only. Rename, reorder, or retire (active:false).
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { name, order, active } = req.body;
  const stage = await prisma.taskStageOption.findUnique({ where: { id: req.params.id } });
  if (!stage) return res.status(404).json({ error: 'Stage not found.' });
  const updated = await prisma.taskStageOption.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  });
  await logActivity(`${req.user.fullName} updated the task stage "${updated.name}".`, req.user.id);
  res.json(updated);
});

// DELETE /api/task-stages/:id — Admin/Super Admin only. Permanently
// removes it. Any task currently sitting on this stage keeps its stored
// string value regardless (Task.stage is just text, not a foreign key),
// so this never breaks an existing task — it only stops the stage from
// appearing as a future option.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const stage = await prisma.taskStageOption.findUnique({ where: { id: req.params.id } });
  if (!stage) return res.status(404).json({ error: 'Stage not found.' });
  await prisma.taskStageOption.delete({ where: { id: req.params.id } });
  await logActivity(`${req.user.fullName} deleted the task stage "${stage.name}".`, req.user.id);
  res.json({ success: true });
});

module.exports = router;
