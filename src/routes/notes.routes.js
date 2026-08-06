const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/notes — every note belonging to the signed-in user, newest first.
// No role restriction — works the same for Admin, Employee, Partner, Student.
router.get('/', requireAuth, async (req, res) => {
  const notes = await prisma.personalNote.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(notes);
});

// POST /api/notes — Body: { content }
router.post('/', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content is required.' });
  const note = await prisma.personalNote.create({
    data: { userId: req.user.id, content: content.trim() },
  });
  res.status(201).json(note);
});

// PATCH /api/notes/:id — only the note's own owner can edit it. Body: { content }
router.patch('/:id', requireAuth, async (req, res) => {
  const { content } = req.body;
  const note = await prisma.personalNote.findUnique({ where: { id: req.params.id } });
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (note.userId !== req.user.id) return res.status(403).json({ error: 'Not your note.' });
  const updated = await prisma.personalNote.update({ where: { id: note.id }, data: { content } });
  res.json(updated);
});

// DELETE /api/notes/:id — only the note's own owner can delete it.
router.delete('/:id', requireAuth, async (req, res) => {
  const note = await prisma.personalNote.findUnique({ where: { id: req.params.id } });
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (note.userId !== req.user.id) return res.status(403).json({ error: 'Not your note.' });
  await prisma.personalNote.delete({ where: { id: note.id } });
  res.json({ success: true });
});

module.exports = router;
