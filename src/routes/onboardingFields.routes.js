const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/onboarding-fields?targetRole=STAFF|CHANNEL_PARTNER|TASK — any
// signed-in user. Defaults to STAFF (Employees/Students) if not
// specified, matching every existing caller's current behavior exactly
// - none of them need to change to keep working as before.
router.get('/', requireAuth, async (req, res) => {
  try {
    const targetRole = ['CHANNEL_PARTNER', 'TASK'].includes(req.query.targetRole) ? req.query.targetRole : 'STAFF';
    const fields = await prisma.onboardingFieldDefinition.findMany({
      where: { active: true, targetRole },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(fields);
  } catch (err) {
    console.error('[onboarding-fields] GET failed:', err);
    res.status(500).json({ error: 'Could not load onboarding fields: ' + err.message });
  }
});

// POST /api/onboarding-fields — Admin/Super Admin only.
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { label, fieldType, targetRole } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required.' });
  const resolvedRole = ['CHANNEL_PARTNER', 'TASK'].includes(targetRole) ? targetRole : 'STAFF';
  const maxOrder = await prisma.onboardingFieldDefinition.aggregate({ where: { targetRole: resolvedRole }, _max: { sortOrder: true } });
  const field = await prisma.onboardingFieldDefinition.create({
    data: {
      label, fieldType: ['TEXT', 'DATE', 'TEXTAREA'].includes(fieldType) ? fieldType : 'TEXT',
      targetRole: resolvedRole,
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

// The fixed set of built-in Onboarding Form fields whose display label
// can be renamed. Kept as an explicit whitelist here (matching the
// actual User columns these read from) so an arbitrary/invalid key
// can never be saved - this isn't a dynamic field system, just a
// label override for a known, fixed set of columns.
const RENAMABLE_FIXED_FIELDS = {
  fatherName: "Father's Name", motherName: "Mother's Name", bloodGroup: 'Blood Group',
  personalEmail: 'Personal Email', currentAddress: 'Current Address', residenceAddress: 'Residence Address',
  emergencyContactName: 'Emergency Contact', emergencyContactRelation: 'Emergency Relation', emergencyContactPhone: 'Emergency Phone',
  // Channel Partner fields, on the separate PartnerProfile model.
  // Deliberately prefixed "partner_" - PartnerProfile has its own
  // emergencyContactName/Phone/Relation columns with the same names as
  // User's above, and without the prefix a rename for one role would
  // silently also rename the other, since both would share one key.
  partner_firstName: 'First Name', partner_surname: 'Surname',
  partner_bankAccountHolderName: 'Bank Account Holder Name', partner_bankAccountNumber: 'Bank Account Number',
  partner_bankIfscCode: 'Bank IFSC Code', partner_bankName: 'Bank Name',
  partner_emergencyContactName: 'Emergency Contact', partner_emergencyContactPhone: 'Emergency Phone', partner_emergencyContactRelation: 'Emergency Relation',
};

// GET /api/onboarding-fields/fixed-labels — any signed-in user. Returns
// { fieldKey: currentLabel } for every renamable fixed field, using the
// default label wherever no override has been saved.
router.get('/fixed-labels', requireAuth, async (req, res) => {
  const overrides = await prisma.onboardingFieldLabel.findMany();
  const labels = { ...RENAMABLE_FIXED_FIELDS };
  overrides.forEach(o => { if (o.fieldKey in labels) labels[o.fieldKey] = o.label; });
  res.json(labels);
});

// PATCH /api/onboarding-fields/fixed-labels/:fieldKey — Admin/Super
// Admin only. fieldKey must be one of the known renamable fields.
router.patch('/fixed-labels/:fieldKey', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { fieldKey } = req.params;
  const { label } = req.body;
  if (!(fieldKey in RENAMABLE_FIXED_FIELDS)) return res.status(400).json({ error: 'Not a renamable field.' });
  if (!label || !label.trim()) return res.status(400).json({ error: 'label cannot be empty.' });
  const saved = await prisma.onboardingFieldLabel.upsert({
    where: { fieldKey },
    update: { label: label.trim() },
    create: { fieldKey, label: label.trim() },
  });
  res.json(saved);
});

module.exports = router;
