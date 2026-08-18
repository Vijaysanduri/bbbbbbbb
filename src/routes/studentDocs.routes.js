const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
const prisma = new PrismaClient();

// ---------------- Requirements (the checklist itself) ----------------

// GET /api/student-docs/requirements?country=UK — anyone signed in.
// Optional country filter; requirements with country=null apply to everyone.
// Staff (managing the checklist library) see every requirement,
// including ones individually targeted at a specific student. Students
// themselves only ever see broad requirements plus whichever ones were
// specifically targeted at them — never another student's individual
// requirement.
router.get('/requirements', requireAuth, async (req, res) => {
  const { country } = req.query;
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'].includes(req.user.role);
  const broadWhere = country ? { OR: [{ country }, { country: null }] } : {};
  const requirements = await prisma.studentDocRequirement.findMany({
    where: isStaff ? broadWhere : { AND: [broadWhere, { OR: [{ targetUserId: null }, { targetUserId: req.user.id }] }] },
    include: { targetUser: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(requirements);
});

// POST /api/student-docs/requirements — Admin/Super Admin/Employee/Counsellor/Manager only.
// Body: { title, description, country, targetUserId } — country omitted/null
// = applies to every destination; targetUserId set = applies ONLY to that
// one student, overriding the broad country matching entirely.
router.post('/requirements', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { title, description, country, targetUserId } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const requirement = await prisma.studentDocRequirement.create({
    data: { title, description: description || null, country: targetUserId ? null : (country || null), createdById: req.user.id, targetUserId: targetUserId || null },
  });

  // Notify students this applies to — just the one targeted student if
  // set, otherwise everyone matching (or everyone, if no country set).
  const students = targetUserId
    ? await prisma.user.findMany({ where: { id: targetUserId, active: true } })
    : await prisma.user.findMany({ where: { role: 'STUDENT', active: true, ...(country ? { country } : {}) } });
  for (const student of students) {
    await sendMail({
      to: student.email,
      subject: `New document required: ${title}`,
      body: `Hi ${student.fullName},\n\nPlease upload "${title}" from your student portal under Document Checklist.\n\nBest,\nDream2Fly`,
    });
  }
  res.status(201).json(requirement);
});

// DELETE /api/student-docs/requirements/:id — Admin/Super Admin only.
router.delete('/requirements/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  await prisma.studentDocRequirement.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// PATCH /api/student-docs/requirements/:id — Admin/Super Admin/Employee/Counsellor/Manager only.
// Body: any of { title, description, country, active } — active:false hides
// it from students' own checklist without deleting the requirement or any
// submissions already made against it.
router.patch('/requirements/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { title, description, country, active } = req.body;
  const requirement = await prisma.studentDocRequirement.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(country !== undefined ? { country: country || null } : {}),
      ...(active !== undefined ? { active: !!active } : {}),
    },
  });
  res.json(requirement);
});

// ---------------- Submissions ----------------

// GET /api/student-docs/submissions/me — the signed-in student's own
// checklist status: every requirement relevant to their country (plus
// universal ones), with their submission if one exists.
router.get('/submissions/me', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.user.id } });
  const requirements = await prisma.studentDocRequirement.findMany({
    where: { active: true, ...(me.country ? { OR: [{ country: me.country }, { country: null }] } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  const submissions = await prisma.studentDocSubmission.findMany({ where: { studentId: req.user.id } });
  const combined = requirements.map(r => ({
    requirement: r,
    submission: submissions.find(s => s.requirementId === r.id) || null,
  }));
  res.json(combined);
});

// POST /api/student-docs/submissions — Student only.
// Body: { requirementId, fileName, mimeType, fileData }
router.post('/submissions', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const { requirementId, fileName, mimeType, fileData } = req.body;
  if (!requirementId || !fileName || !fileData) {
    return res.status(400).json({ error: 'requirementId, fileName and fileData are required.' });
  }
  const requirement = await prisma.studentDocRequirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return res.status(404).json({ error: 'Requirement not found.' });

  const submission = await prisma.studentDocSubmission.upsert({
    where: { requirementId_studentId: { requirementId, studentId: req.user.id } },
    update: { fileName, mimeType: mimeType || 'application/pdf', fileData, status: 'PENDING', reviewNotes: null, reviewedById: null, reviewedAt: null, submittedAt: new Date() },
    create: { requirementId, studentId: req.user.id, fileName, mimeType: mimeType || 'application/pdf', fileData },
  });
  await logActivity(`${req.user.fullName} uploaded "${requirement.title}".`, req.user.id);

  const staff = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'] }, active: true } });
  for (const person of staff) {
    await sendMail({
      to: person.email,
      subject: `Document submitted: ${requirement.title} (${req.user.fullName})`,
      body: `${req.user.fullName} has uploaded "${requirement.title}" for review. Check Admin → Student Document Checklist.`,
    });
  }
  res.status(201).json(submission);
});

// GET /api/student-docs/submissions — Admin/Super Admin/Employee/Counsellor/Manager only.
// Every submission across every student and requirement.
router.get('/submissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const submissions = await prisma.studentDocSubmission.findMany({
    include: { requirement: true, student: { select: { fullName: true, email: true, country: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  res.json(submissions);
});

// GET /api/student-docs/submissions/:id — owner student or staff only.
router.get('/submissions/:id', requireAuth, async (req, res) => {
  const submission = await prisma.studentDocSubmission.findUnique({ where: { id: req.params.id }, include: { requirement: true } });
  if (!submission) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'].includes(req.user.role);
  if (!isStaff && submission.studentId !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
  if (isStaff) await logActivity(`${req.user.fullName} downloaded "${submission.requirement.title}" (Student Document).`, req.user.id);
  res.json(submission);
});

// PATCH /api/student-docs/submissions/:id — Admin/Super Admin/Employee/Counsellor/Manager only.
// Body: { status: 'APPROVED'|'REJECTED', reviewNotes }
router.patch('/submissions/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const { status, reviewNotes } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED.' });
  const submission = await prisma.studentDocSubmission.update({
    where: { id: req.params.id },
    data: { status, reviewNotes: reviewNotes || null, reviewedById: req.user.id, reviewedAt: new Date() },
    include: { requirement: true, student: true },
  });
  await sendMail({
    to: submission.student.email,
    subject: `Document ${status.toLowerCase()}: ${submission.requirement.title}`,
    body: `Hi ${submission.student.fullName},\n\nYour submission for "${submission.requirement.title}" has been ${status.toLowerCase()}.${reviewNotes ? '\n\nNote: ' + reviewNotes : ''}\n\nBest,\nDream2Fly`,
  });
  res.json(submission);
});

module.exports = router;
