const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/email-templates — any signed-in staff member. Powers the
// "Quick template" dropdown in the candidate email composer, and the
// management list. Only active templates by default; pass
// ?includeInactive=1 to also see retired ones (for the management view).
router.get('/', requireAuth, async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const templates = await prisma.emailTemplate.findMany({
    where: includeInactive ? {} : { active: true },
    select: { id: true, name: true, subject: true, body: true, active: true, createdAt: true, createdBy: { select: { fullName: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(templates);
});

// POST /api/email-templates — any signed-in staff member can add one.
// This is a shared team resource (like Information Material), not
// admin-locked — a counsellor who writes a good "Pending documents"
// message should be able to save it for everyone to reuse, not wait on
// an admin to add it for them.
router.post('/', requireAuth, async (req, res) => {
  const { name, subject, body } = req.body;
  if (!name || !subject || !body) {
    return res.status(400).json({ error: 'name, subject, and body are all required.' });
  }
  const template = await prisma.emailTemplate.create({
    data: { name, subject, body, createdById: req.user.id },
  });
  await logActivity(`${req.user.fullName} added the email template "${name}".`, req.user.id);
  res.status(201).json(template);
});

// PATCH /api/email-templates/:id — edit or retire (active:false) a template.
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, subject, body, active } = req.body;
  const template = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  const updated = await prisma.emailTemplate.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  });
  await logActivity(`${req.user.fullName} updated the email template "${updated.name}".`, req.user.id);
  res.json(updated);
});

// DELETE /api/email-templates/:id — permanently removes it. Templates
// already used in past emails aren't affected (the email itself stored
// its own final text, not a reference to this template).
router.delete('/:id', requireAuth, async (req, res) => {
  const template = await prisma.emailTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  await prisma.emailTemplate.delete({ where: { id: req.params.id } });
  await logActivity(`${req.user.fullName} deleted the email template "${template.name}".`, req.user.id);
  res.json({ success: true });
});

module.exports = router;
