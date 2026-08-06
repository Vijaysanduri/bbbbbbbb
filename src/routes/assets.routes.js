const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// ---------------- Custom field definitions (Admin only) ----------------
// Lets Admin add new asset fields (e.g. "Serial Number") without a schema
// change — values are stored per-asset in Asset.customFieldsJson.

router.get('/field-definitions', requireAuth, async (req, res) => {
  const defs = await prisma.assetFieldDefinition.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(defs);
});

router.post('/field-definitions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required.' });
  const def = await prisma.assetFieldDefinition.create({ data: { label } });
  res.status(201).json(def);
});

router.delete('/field-definitions/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.assetFieldDefinition.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ---------------- Asset catalog ----------------

// GET /api/assets — Admin/HR/Super Admin only. The full catalog, with
// current assignment (if any) included.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const assets = await prisma.asset.findMany({
    include: { assignments: { where: { status: 'ACTIVE' }, include: { user: { select: { fullName: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(assets);
});

// POST /api/assets — Admin/HR/Super Admin only.
// Body: { name, category, customFields: { [fieldDefinitionId]: value } }
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { name, category, customFields } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category are required.' });
  const asset = await prisma.asset.create({
    data: { name, category, customFieldsJson: customFields ? JSON.stringify(customFields) : null },
  });
  res.status(201).json(asset);
});

router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { name, category, customFields, status } = req.body;
  const asset = await prisma.asset.update({
    where: { id: req.params.id },
    data: {
      ...(name ? { name } : {}),
      ...(category ? { category } : {}),
      ...(customFields ? { customFieldsJson: JSON.stringify(customFields) } : {}),
      ...(status ? { status } : {}),
    },
  });
  res.json(asset);
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  await prisma.asset.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ---------------- Assignment ----------------

// POST /api/assets/:id/assign — HR/Super Admin only.
// Body: { userId }
// Creates the assignment record; the agreement is added afterward, either
// by the employee digitally signing or by Admin/HR uploading a scanned
// signed copy — kept as a separate step so either path works cleanly.
router.post('/:id/assign', requireAuth, requireRole('HR', 'SUPER_ADMIN'), async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (asset.status === 'ASSIGNED') return res.status(400).json({ error: 'This asset is already assigned to someone.' });

  const assignment = await prisma.assetAssignment.create({
    data: { assetId: asset.id, userId, assignedById: req.user.id },
  });
  await prisma.asset.update({ where: { id: asset.id }, data: { status: 'ASSIGNED' } });

  const employee = await prisma.user.findUnique({ where: { id: userId }, include: { reportingManager: true } });
  if (employee) {
    const assetDetails = `Asset: ${asset.name}\nCategory: ${asset.category}\nAssigned to: ${employee.fullName}\nAssigned on: ${new Date().toLocaleDateString('en-GB')}`;
    const subject = `Company Asset Assigned — ${asset.name} → ${employee.fullName}`;

    await sendMail({
      to: employee.email,
      subject,
      body: `Hi ${employee.fullName},\n\n"${asset.name}" (${asset.category}) has been assigned to you. Please review and digitally sign the agreement from your profile under Company Assets, or your HR contact will arrange the signed paperwork with you.\n\n${assetDetails}\n\nBest,\nDream2Fly HR`,
    });

    // Also notify the reporting manager and HR, so the assignment is
    // visible beyond just the employee — with the full asset details in
    // a clear subject line, per the request that this be easy to spot.
    const recipients = [];
    if (employee.reportingManager) recipients.push(employee.reportingManager);
    const hrUsers = await prisma.user.findMany({ where: { role: 'HR', active: true } });
    recipients.push(...hrUsers);
    const seen = new Set([employee.email]);
    for (const person of recipients) {
      if (seen.has(person.email)) continue;
      seen.add(person.email);
      await sendMail({
        to: person.email,
        subject,
        body: `Hi ${person.fullName},\n\nFor your records — a company asset has just been assigned:\n\n${assetDetails}\n\nBest,\nDream2Fly HR`,
      });
    }
  }
  await logActivity(`${asset.name} assigned to ${employee ? employee.fullName : 'someone'}.`, req.user.id);
  res.status(201).json(assignment);
});

// GET /api/assets/me — the signed-in employee's own assigned assets,
// synced to their profile.
router.get('/me', requireAuth, async (req, res) => {
  const assignments = await prisma.assetAssignment.findMany({
    where: { userId: req.user.id },
    include: { asset: true },
    orderBy: { assignedAt: 'desc' },
  });
  res.json(assignments);
});

// POST /api/assets/assignments/:id/sign — the assignment's own employee only.
// Body: { typedName } — a typed full name + timestamp stands in as the
// "digital signature" here (no third-party e-sign integration wired up).
router.post('/assignments/:id/sign', requireAuth, async (req, res) => {
  const { typedName } = req.body;
  if (!typedName) return res.status(400).json({ error: 'typedName is required.' });
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: req.params.id }, include: { asset: true } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  if (assignment.userId !== req.user.id) return res.status(403).json({ error: 'Not your assignment.' });
  const updated = await prisma.assetAssignment.update({
    where: { id: assignment.id },
    data: { signedByTypedName: typedName, signedAt: new Date() },
  });
  await logActivity(`${req.user.fullName} signed the agreement for ${assignment.asset.name}.`, req.user.id);
  res.json(updated);
});

// POST /api/assets/assignments/:id/upload-agreement — Admin/HR/Super Admin,
// or the employee themselves. Body: { fileData, fileName } — for when a
// scanned, physically-signed copy is used instead of typing a signature.
router.post('/assignments/:id/upload-agreement', requireAuth, async (req, res) => {
  const { fileData, fileName } = req.body;
  if (!fileData || !fileName) return res.status(400).json({ error: 'fileData and fileName are required.' });
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: req.params.id }, include: { asset: true } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  const isOwner = assignment.userId === req.user.id;
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'HR'].includes(req.user.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: 'Not authorized.' });
  const updated = await prisma.assetAssignment.update({
    where: { id: assignment.id },
    data: { uploadedAgreementFileData: fileData, uploadedAgreementFileName: fileName, uploadedAgreementAt: new Date() },
  });
  await logActivity(`${req.user.fullName} uploaded a signed agreement copy for ${assignment.asset.name}.`, req.user.id);
  res.json(updated);
});

// POST /api/assets/assignments/:id/report — the assignment's own employee
// only. Body: { reportType: 'STILL_HAVE_IT' | 'NEEDS_REPLACEMENT', note }
router.post('/assignments/:id/report', requireAuth, async (req, res) => {
  const { reportType, note } = req.body;
  if (!['STILL_HAVE_IT', 'NEEDS_REPLACEMENT'].includes(reportType)) {
    return res.status(400).json({ error: 'reportType must be STILL_HAVE_IT or NEEDS_REPLACEMENT.' });
  }
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: req.params.id }, include: { asset: true, user: true } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  if (assignment.userId !== req.user.id) return res.status(403).json({ error: 'Not your assignment.' });

  const updated = await prisma.assetAssignment.update({
    where: { id: assignment.id },
    data: {
      reportType, reportNote: note || null, reportedAt: new Date(),
      status: reportType === 'NEEDS_REPLACEMENT' ? 'REPLACEMENT_REQUESTED' : assignment.status,
    },
  });

  if (reportType === 'NEEDS_REPLACEMENT') {
    const hrUsers = await prisma.user.findMany({ where: { role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, active: true } });
    for (const hr of hrUsers) {
      await sendMail({
        to: hr.email,
        subject: `Replacement requested: ${assignment.asset.name} (${assignment.user.fullName})`,
        body: `${assignment.user.fullName} has requested a replacement for "${assignment.asset.name}".\n\nNote: ${note || '(none provided)'}\n\nPlease review in Admin → Company Assets.`,
      });
    }
  }
  res.json(updated);
});

// GET /api/assets/reports — Admin/HR/Super Admin only. Every assignment
// with an open replacement request, to action.
router.get('/reports', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const reports = await prisma.assetAssignment.findMany({
    where: { status: 'REPLACEMENT_REQUESTED' },
    include: { asset: true, user: { select: { fullName: true, email: true } } },
    orderBy: { reportedAt: 'desc' },
  });
  res.json(reports);
});

// PATCH /api/assets/assignments/:id/return — Admin/HR/Super Admin only.
// Marks the assignment returned/closed and frees up the asset.
router.patch('/assignments/:id/return', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  const updated = await prisma.assetAssignment.update({
    where: { id: assignment.id },
    data: { status: 'RETURNED', returnedAt: new Date() },
  });
  await prisma.asset.update({ where: { id: assignment.assetId }, data: { status: 'AVAILABLE' } });
  res.json(updated);
});

module.exports = router;
