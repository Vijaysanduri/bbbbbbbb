const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, requirePermission, requireHrCapability } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/resignations/me — the signed-in employee's own resignation
// history (usually just the latest, but returns all in case one was
// withdrawn and resubmitted).
router.get('/me', requireAuth, async (req, res) => {
  const resignations = await prisma.resignation.findMany({
    where: { userId: req.user.id },
    orderBy: { requestedAt: 'desc' },
  });
  res.json(resignations);
});

// POST /api/resignations — any signed-in employee. Body: { reason, proposedLastDay }
// Refuses a new submission if one is already PENDING.
router.post('/', requireAuth, async (req, res) => {
  const { reason, proposedLastDay } = req.body;
  if (!proposedLastDay) return res.status(400).json({ error: 'proposedLastDay is required.' });
  const existing = await prisma.resignation.findFirst({ where: { userId: req.user.id, status: 'PENDING' } });
  if (existing) return res.status(400).json({ error: 'You already have a resignation request pending review.' });

  const resignation = await prisma.resignation.create({
    data: { userId: req.user.id, reason: reason || null, proposedLastDay: new Date(proposedLastDay) },
  });

  const employee = await prisma.user.findUnique({ where: { id: req.user.id }, include: { reportingManager: true } });
  const recipients = [];
  if (employee.reportingManager) recipients.push(employee.reportingManager);
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'HR'] }, active: true } });
  recipients.push(...admins);
  const seen = new Set();
  for (const r of recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    await sendMail({
      to: r.email,
      subject: `Resignation submitted: ${employee.fullName}`,
      body: `Hi ${r.fullName},\n\n${employee.fullName} has submitted their resignation, with a proposed last working day of ${new Date(proposedLastDay).toLocaleDateString('en-GB')}.\n\nReason: ${reason || '(not provided)'}\n\nPlease discuss with them and record the outcome in the Admin dashboard.\n\nBest,\nDream2Fly`,
    });
  }
  res.status(201).json(resignation);
});

// POST /api/resignations/:id/withdraw — the employee's own, only while still PENDING.
router.post('/:id/withdraw', requireAuth, async (req, res) => {
  const resignation = await prisma.resignation.findUnique({ where: { id: req.params.id } });
  if (!resignation) return res.status(404).json({ error: 'Not found.' });
  if (resignation.userId !== req.user.id) return res.status(403).json({ error: 'Not your resignation.' });
  if (resignation.status !== 'PENDING') return res.status(400).json({ error: 'Only a pending resignation can be withdrawn.' });
  const updated = await prisma.resignation.update({ where: { id: resignation.id }, data: { status: 'WITHDRAWN' } });
  res.json(updated);
});

// GET /api/resignations — Admin/Super Admin/HR/Manager only. Every
// resignation across the company, newest first.
router.get('/', requireAuth, async (req, res) => {
  const role = req.user.role;
  let hasFullAccess = ['ADMIN', 'SUPER_ADMIN'].includes(role);
  let allowed = hasFullAccess || role === 'MANAGER';
  if (role === 'HR') {
    const settings = await prisma.roleCapabilitySettings.findUnique({ where: { id: 'singleton' } });
    if (!settings || settings.hrSeesResignations !== false) { allowed = true; hasFullAccess = true; }
  }
  if (!hasFullAccess && role !== 'HR') {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { canAccessResignationsAdmin: true } });
    if (user && user.canAccessResignationsAdmin) { allowed = true; hasFullAccess = true; }
  }
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to do this.' });

  const where = (role === 'MANAGER' && !hasFullAccess) ? { user: { reportingManagerId: req.user.id } } : {};
  const resignations = await prisma.resignation.findMany({
    where,
    include: { user: { select: { fullName: true, email: true, jobTitle: true, reportingManagerId: true } } },
    orderBy: { requestedAt: 'desc' },
  });
  res.json(resignations);
});

// PATCH /api/resignations/:id — Admin/Super Admin/Manager (own reports), or anyone granted the Resignations Admin permission.
// Body: { status: 'APPROVED'|'REJECTED', managerNotes, actualLastWorkingDay }
// A Manager may only decide on resignations for their own direct reports;
// Admin/HR/Super Admin can decide on anyone's.
router.patch('/:id', requireAuth, requireHrCapability('hrSeesResignations', requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN', 'MANAGER')), async (req, res) => {
  const { status, managerNotes, actualLastWorkingDay } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const resignation = await prisma.resignation.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!resignation) return res.status(404).json({ error: 'Not found.' });

  if (req.user.role === 'MANAGER' && resignation.user.reportingManagerId !== req.user.id) {
    return res.status(403).json({ error: 'You can only decide on resignations for your own direct reports.' });
  }

  const updated = await prisma.resignation.update({
    where: { id: resignation.id },
    data: {
      status, managerNotes: managerNotes || null, reviewedById: req.user.id, reviewedAt: new Date(),
      actualLastWorkingDay: status === 'APPROVED' ? new Date(actualLastWorkingDay || resignation.proposedLastDay) : null,
    },
  });

  await sendMail({
    to: resignation.user.email,
    subject: `Your resignation has been ${status.toLowerCase()}`,
    body: `Hi ${resignation.user.fullName},\n\nYour resignation has been ${status.toLowerCase()}${status === 'APPROVED' ? `, with a last working day of ${updated.actualLastWorkingDay.toLocaleDateString('en-GB')}` : ''}.${managerNotes ? '\n\nNote: ' + managerNotes : ''}\n\nBest,\nDream2Fly HR`,
  });
  await logActivity(`${resignation.user.fullName}'s resignation was ${status.toLowerCase()}.`, req.user.id);
  res.json(updated);
});

// GET /api/resignations/:id/asset-status — Admin/Super Admin/HR/Manager.
// Every asset still assigned (ACTIVE/REPLACEMENT_REQUESTED) to this
// resigning employee — what needs to come back before clearance.
router.get('/:id/asset-status', requireAuth, requireHrCapability('hrSeesResignations', requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN', 'MANAGER')), async (req, res) => {
  const resignation = await prisma.resignation.findUnique({ where: { id: req.params.id } });
  if (!resignation) return res.status(404).json({ error: 'Not found.' });
  const outstandingAssets = await prisma.assetAssignment.findMany({
    where: { userId: resignation.userId, status: { in: ['ACTIVE', 'REPLACEMENT_REQUESTED'] } },
    include: { asset: true },
  });
  res.json({ outstandingAssets, allReturned: outstandingAssets.length === 0 });
});

// PATCH /api/resignations/:id/clearance — Admin/Super Admin/HR only.
// Body: { assetsCleared: boolean } — marks whether all company assets
// (laptop, ID card, etc.) have been physically returned.
router.patch('/:id/clearance', requireAuth, requireHrCapability('hrSeesResignations', requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN')), async (req, res) => {
  const { assetsCleared } = req.body;
  const updated = await prisma.resignation.update({
    where: { id: req.params.id },
    data: { assetsCleared: !!assetsCleared, assetsClearedAt: assetsCleared ? new Date() : null, assetsClearedById: assetsCleared ? req.user.id : null },
  });
  res.json(updated);
});

// POST /api/resignations/:id/release — Admin/Super Admin/HR only.
// Body: { financialClearanceNotes, experienceLetterFileData, experienceLetterFileName }
// Releases pending dues and issues the experience letter — refuses unless
// assets have already been marked cleared, enforced here (not just in the
// UI) so this can't be bypassed.
router.post('/:id/release', requireAuth, requireHrCapability('hrSeesResignations', requirePermission('canAccessResignationsAdmin', 'ADMIN', 'SUPER_ADMIN')), async (req, res) => {
  const { financialClearanceNotes, experienceLetterFileData, experienceLetterFileName } = req.body;
  const resignation = await prisma.resignation.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!resignation) return res.status(404).json({ error: 'Not found.' });
  if (resignation.status !== 'APPROVED') return res.status(400).json({ error: 'Resignation must be approved first.' });
  if (!resignation.assetsCleared) return res.status(400).json({ error: 'Assets must be marked cleared before releasing final dues.' });

  const updated = await prisma.resignation.update({
    where: { id: resignation.id },
    data: {
      financialClearance: true, financialClearanceNotes: financialClearanceNotes || null, financialClearanceAt: new Date(),
      experienceLetterFileData: experienceLetterFileData || null, experienceLetterFileName: experienceLetterFileName || null,
      experienceLetterIssuedAt: experienceLetterFileData ? new Date() : null,
    },
  });

  await sendMail({
    to: resignation.user.email,
    subject: 'Your final settlement and experience letter',
    body: `Hi ${resignation.user.fullName},\n\nYour offboarding clearance is complete — final dues have been released${experienceLetterFileData ? ', and your experience letter is attached' : ''}.${financialClearanceNotes ? '\n\nNote: ' + financialClearanceNotes : ''}\n\nBest wishes for the future,\nDream2Fly HR`,
    ...(experienceLetterFileData ? { attachmentFileName: experienceLetterFileName, attachmentBase64: experienceLetterFileData, attachmentMimeType: 'application/pdf' } : {}),
  });
  await logActivity(`Final dues released for ${resignation.user.fullName}.`, req.user.id);
  res.json(updated);
});

module.exports = router;
