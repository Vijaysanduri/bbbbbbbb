const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { sendMail, renderTemplate } = require('../utils/mailer');

const router = express.Router();
const prisma = new PrismaClient();

async function logActivity(text, actorId) {
  await prisma.activityLog.create({ data: { text, actorId } });
}

// GET /api/tasks?name=&country=&from=&to=
router.get('/', requireAuth, async (req, res) => {
  const { name, country, from, to } = req.query;
  const where = {
    ...(name ? { related: { contains: name } } : {}),
    ...(country ? { country } : {}),
    ...(from || to ? { due: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {})
  };
  const tasks = await prisma.task.findMany({
    where,
    include: { comments: { orderBy: { createdAt: 'asc' } } },
    orderBy: { due: 'asc' }
  });
  res.json(tasks);
});

// GET /api/tasks/:id
router.get('/:id', requireAuth, async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: { comments: { orderBy: { createdAt: 'asc' }, include: { author: true } } }
  });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json(task);
});

// POST /api/tasks
// Body: { title, related, country, due, priority }
router.post('/', requireAuth, async (req, res) => {
  const { title, related, country, due, priority } = req.body;
  if (!title || !related || !country || !due) {
    return res.status(400).json({ error: 'title, related, country and due are required.' });
  }
  const task = await prisma.task.create({
    data: { title, related, country, due: new Date(due), priority: priority || 'MEDIUM', assignedEmployeeId: req.user.id }
  });
  await logActivity(`New task created: ${title} (related to ${related}).`, req.user.id);
  res.status(201).json(task);
});

// PATCH /api/tasks/:id/status
// Body: { status }
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const updated = await prisma.task.update({ where: { id: task.id }, data: { status } });
  const email = renderTemplate(status, task.related);
  const mailResult = await sendMail({ to: `${task.related.replace(/\s+/g, '.').toLowerCase()}@example.com`, subject: email.subject, body: email.body });

  await prisma.comment.create({
    data: { taskId: task.id, isSystem: true, text: `Status changed to "${status}" — email ${mailResult.delivered ? 'sent' : 'logged'} to ${task.related}.` }
  });
  await logActivity(`${task.related} — task "${task.title}" status changed to "${status}".`, req.user.id);

  res.json({ task: updated, email, mailResult });
});

// POST /api/tasks/:id/comments
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const comment = await prisma.comment.create({ data: { taskId: task.id, authorId: req.user.id, text }, include: { author: true } });
  await logActivity(`${task.related} — ${text}`, req.user.id);
  res.status(201).json(comment);
});

module.exports = router;
