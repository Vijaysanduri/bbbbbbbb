const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// ---------------- Requirements (the checklist itself) ----------------

// GET /api/partner-docs/requirements — anyone signed in can see the
// checklist. Staff see everything (including items targeted at a
// specific partner); partners themselves only see broad requirements
// plus whichever ones were specifically targeted at them.
router.get('/requirements', requireAuth, async (req, res) => {
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'].includes(req.user.role);
  const requirements = await prisma.partnerDocRequirement.findMany({
    where: isStaff ? {} : { OR: [{ targetUserId: null }, { targetUserId: req.user.id }] },
    include: { targetUser: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(requirements);
});

// POST /api/partner-docs/requirements — Admin/Super Admin only.
// Body: { title, description, targetUserId } — targetUserId set = this
// requirement applies only to that one partner, not the whole roster.
router.post('/requirements', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { title, description, targetUserId } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const requirement = await prisma.partnerDocRequirement.create({
    data: { title, description: description || null, createdById: req.user.id, targetUserId: targetUserId || null },
  });

  // Let every active partner know a new document is needed from them —
  // or just the one targeted partner, if this was set for an individual.
  const partners = targetUserId
    ? await prisma.user.findMany({ where: { id: targetUserId, active: true } })
    : await prisma.user.findMany({ where: { role: 'CHANNEL_PARTNER', active: true } });
  for (const partner of partners) {
    await sendMail({
      to: partner.email,
      subject: `New document required: ${title}`,
      body: `Hi ${partner.fullName},\n\nPlease upload "${title}" from your Partner dashboard under Documents.\n\nBest,\nDream2Fly`,
    });
  }
  res.status(201).json(requirement);
});

// DELETE /api/partner-docs/requirements/:id — Admin/Super Admin only.
router.delete('/requirements/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.partnerDocRequirement.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// PATCH /api/partner-docs/requirements/:id — Admin/Super Admin only.
// Body: any of { title, description, active } — active:false hides it from
// partners' own checklist and stops new-partner notification emails,
// without deleting the requirement or any submissions already made
// against it (so history/audit stays intact).
router.patch('/requirements/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { title, description, active } = req.body;
  const requirement = await prisma.partnerDocRequirement.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(active !== undefined ? { active: !!active } : {}),
    },
  });
  res.json(requirement);
});

// ---------------- Submissions ----------------

// GET /api/partner-docs/submissions/me — the signed-in partner's own
// checklist status: every requirement, with their submission if one exists.
router.get('/submissions/me', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const requirements = await prisma.partnerDocRequirement.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  const submissions = await prisma.partnerDocSubmission.findMany({ where: { partnerId: req.user.id } });
  const combined = requirements.map(r => ({
    requirement: r,
    submission: submissions.find(s => s.requirementId === r.id) || null,
  }));
  res.json(combined);
});

// POST /api/partner-docs/submissions — Channel Partner only.
// Body: { requirementId, fileName, mimeType, fileData }
// Upserts — a re-upload after rejection replaces the previous submission
// and resets it to PENDING for re-review.
router.post('/submissions', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { requirementId, fileName, mimeType, fileData } = req.body;
  if (!requirementId || !fileName || !fileData) {
    return res.status(400).json({ error: 'requirementId, fileName and fileData are required.' });
  }
  const requirement = await prisma.partnerDocRequirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return res.status(404).json({ error: 'Requirement not found.' });

  const submission = await prisma.partnerDocSubmission.upsert({
    where: { requirementId_partnerId: { requirementId, partnerId: req.user.id } },
    update: { fileName, mimeType: mimeType || 'application/pdf', fileData, status: 'PENDING', reviewNotes: null, reviewedById: null, reviewedAt: null, submittedAt: new Date() },
    create: { requirementId, partnerId: req.user.id, fileName, mimeType: mimeType || 'application/pdf', fileData },
  });
  await logActivity(`${req.user.fullName} uploaded "${requirement.title}".`, req.user.id);

  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `Document submitted: ${requirement.title} (${req.user.fullName})`,
      body: `${req.user.fullName} has uploaded "${requirement.title}" for review. Check Admin → Partner Documents.`,
    });
  }
  res.status(201).json(submission);
});

// GET /api/partner-docs/submissions — Admin/Super Admin only. Every
// submission across every partner and requirement.
router.get('/submissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const submissions = await prisma.partnerDocSubmission.findMany({
    include: { requirement: true, partner: { select: { fullName: true, email: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  res.json(submissions);
});

// GET /api/partner-docs/submissions/:id/download — owner partner or Admin only.
router.get('/submissions/:id', requireAuth, async (req, res) => {
  const submission = await prisma.partnerDocSubmission.findUnique({ where: { id: req.params.id }, include: { requirement: true } });
  if (!submission) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  if (!isStaff && submission.partnerId !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
  if (isStaff) await logActivity(`${req.user.fullName} downloaded "${submission.requirement.title}" (Partner Document).`, req.user.id);
  res.json(submission);
});

// PATCH /api/partner-docs/submissions/:id — Admin/Super Admin only.
// Body: { status: 'APPROVED'|'REJECTED', reviewNotes }
router.patch('/submissions/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { status, reviewNotes } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const submission = await prisma.partnerDocSubmission.update({
    where: { id: req.params.id },
    data: { status, reviewNotes: reviewNotes || null, reviewedById: req.user.id, reviewedAt: new Date() },
    include: { requirement: true, partner: true },
  });
  await sendMail({
    to: submission.partner.email,
    subject: `Document ${status.toLowerCase()}: ${submission.requirement.title}`,
    body: `Hi ${submission.partner.fullName},\n\nYour submission for "${submission.requirement.title}" has been ${status.toLowerCase()}.${reviewNotes ? '\n\nNote: ' + reviewNotes : ''}\n\nBest,\nDream2Fly`,
  });
  res.json(submission);
});

module.exports = router;
