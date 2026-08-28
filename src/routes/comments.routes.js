const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// PATCH /api/comments/:id — edit a comment's text. Only the person who
// wrote it, or an Admin/Super Admin, can do this. System-generated
// comments (automated audit trail entries) are never editable through
// here — rewriting those would defeat the point of having them. Every
// edit is preserved in CommentEditHistory rather than silently
// overwriting the previous text.
router.patch('/:id', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.isSystem) return res.status(400).json({ error: 'System-generated comments can\'t be edited.' });

  const isAuthor = comment.authorId === req.user.id;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  if (!isAuthor && !isAdmin) {
    return res.status(403).json({ error: 'Only the person who wrote this comment, or an admin, can edit it.' });
  }

  await prisma.commentEditHistory.create({
    data: { commentId: comment.id, previousText: comment.text, editedById: req.user.id },
  });
  const updated = await prisma.comment.update({
    where: { id: comment.id },
    data: { text: text.trim(), editedAt: new Date() },
    include: { author: { select: { id: true, fullName: true } } },
  });

  res.json(updated);
});

// GET /api/comments/:id/history — the full chain of previous versions,
// oldest first, each showing who made that particular edit and when.
router.get('/:id/history', requireAuth, async (req, res) => {
  const history = await prisma.commentEditHistory.findMany({
    where: { commentId: req.params.id },
    include: { editedBy: { select: { fullName: true } } },
    orderBy: { editedAt: 'asc' },
  });
  res.json(history);
});

module.exports = router;
