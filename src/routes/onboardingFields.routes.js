const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/onboarding-fields — any signed-in user. Everyone filling out
// the Onboarding Form needs to know what custom fields exist, not just
// Admin managing them.
router.get('/', requireAuth, async (req, res) => {
  const fields = await prisma.onboardingFieldDefinition.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(fields);
});

// POST /api/onboarding-fields — Admin/Super Admin only.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { label, fieldType } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required.' });
  const maxOrder = await prisma.onboardingFieldDefinition.aggregate({ _max: { sortOrder: true } });
  const field = await prisma.onboardingFieldDefinition.create({
    data: {
      label, fieldType: ['TEXT', 'DATE', 'TEXTAREA'].includes(fieldType) ? fieldType : 'TEXT',
      sortOrder: (maxOrder._max.sortOrder || 0) + 1, createdById: req.user.id,
    },
  });
  res.status(201).json(field);
});

// PATCH /api/onboarding-fields/:id — Admin/Super Admin only. Edits an
// existing field's label/type. Already-collected values in everyone's
// customOnboardingValues stay keyed by field id, so this doesn't
// affect previously-submitted answers - just what the field is called
// or how it's presented going forward.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { label, fieldType } = req.body;
  const existing = await prisma.onboardingFieldDefinition.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Field not found.' });
  if (label !== undefined && !label.trim()) return res.status(400).json({ error: 'label cannot be empty.' });
  const field = await prisma.onboardingFieldDefinition.update({
    where: { id: req.params.id },
    data: {
      ...(label !== undefined ? { label: label.trim() } : {}),
      ...(fieldType !== undefined && ['TEXT', 'DATE', 'TEXTAREA'].includes(fieldType) ? { fieldType } : {}),
    },
  });
  res.json(field);
});

// DELETE /api/onboarding-fields/:id — Admin/Super Admin only. Soft
// delete (active: false) rather than a real delete — keeps everyone's
// already-answered values in customOnboardingValues intact even if the
// field is retired from the form going forward.
router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.onboardingFieldDefinition.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ success: true });
});

module.exports = router;
