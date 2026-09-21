// Candidate Profile routes — lets one real person (e.g. "Harika") have
// several applications (Tasks) grouped under one profile, so opening her
// file shows a list to pick between "East London", "Northumbria", etc.
//
// DELIBERATE DESIGN CHOICE: this file never touches the Task model and
// never adds a Prisma relation into it. The link between a profile and a
// task (CandidateProfileApplication.taskId) is a plain string, resolved
// with a normal separate query here, not a schema-level relation. That
// was an explicit instruction — the existing Task model and everything
// built on it must stay completely undisturbed. If Task is ever renamed,
// restructured, or partially deleted, this file and its two tables are
// unaffected — they just hold IDs.
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
const prisma = new PrismaClient();

// Small select — keep the task summary shown in the applications list
// light. Extend this list if the dropdown/tab UI ends up needing more
// fields, but avoid pulling comments/documents here — those are fetched
// once a specific application is actually opened, same as today.
const TASK_SUMMARY_SELECT = {
  id: true,
  taskNumber: true,
  title: true,
  related: true,
  country: true,
  status: true,
  priority: true,
  stage: true,
  college: true,
  course: true,
  intake: true,
  applicationId: true,
  caseType: true,
  contactEmail: true,
  contactPhone: true,
  due: true,
};

async function attachApplications(profile) {
  const links = await prisma.candidateProfileApplication.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'asc' },
  });
  const taskIds = links.map((l) => l.taskId);
  const tasks = taskIds.length
    ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: TASK_SUMMARY_SELECT })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const applications = links
    .map((l) => ({ linkId: l.id, taskId: l.taskId, addedAt: l.createdAt, task: taskById.get(l.taskId) || null }))
    // A task can be deleted independently of this table (no DB-level
    // cascade, by design) — drop any link pointing at a task that no
    // longer exists rather than showing a broken row.
    .filter((a) => a.task !== null);
  return { ...profile, applications };
}

// GET /profiles/search?q=harika
// Used by the "attach to existing candidate" flow when creating a new
// application, and by any future search box on this feature.
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const profiles = await prisma.candidateProfile.findMany({
    where: {
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { contactEmail: { contains: q, mode: 'insensitive' } },
        { contactPhone: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 20,
    orderBy: { fullName: 'asc' },
  });
  res.json(profiles);
});

// GET /profiles/by-task/:taskId
// Given a task the UI already has open, find its profile (if any) and
// every sibling application under that profile. This is the call the
// "what if I need to see Northumbria details" flow will use — click a
// candidate's name, get back the full list to switch between.
router.get('/by-task/:taskId', requireAuth, async (req, res) => {
  const link = await prisma.candidateProfileApplication.findUnique({ where: { taskId: req.params.taskId } });
  if (!link) return res.json({ profile: null, applications: [] });
  const profile = await prisma.candidateProfile.findUnique({ where: { id: link.profileId } });
  if (!profile) return res.json({ profile: null, applications: [] });
  const withApps = await attachApplications(profile);
  res.json(withApps);
});

// GET /profiles/:id
router.get('/:id', requireAuth, async (req, res) => {
  const profile = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  res.json(await attachApplications(profile));
});

// POST /profiles
// Creates a brand-new profile. Typically called right before linking the
// candidate's first task to it (or automatically, one-time, by the
// migration script for every existing task).
router.post('/', requireAuth, async (req, res) => {
  const { fullName, contactEmail, contactPhone, nationality, dob, notes } = req.body || {};
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'fullName is required.' });
  }
  const profile = await prisma.candidateProfile.create({
    data: {
      fullName: fullName.trim(),
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      nationality: nationality || null,
      dob: dob ? new Date(dob) : null,
      notes: notes || null,
      createdById: req.user.id,
    },
  });
  res.json(profile);
});

// PATCH /profiles/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const { fullName, contactEmail, contactPhone, nationality, dob, notes } = req.body || {};
  const profile = await prisma.candidateProfile.update({
    where: { id: req.params.id },
    data: {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(contactEmail !== undefined ? { contactEmail } : {}),
      ...(contactPhone !== undefined ? { contactPhone } : {}),
      ...(nationality !== undefined ? { nationality } : {}),
      ...(dob !== undefined ? { dob: dob ? new Date(dob) : null } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
  }).catch(() => null);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  res.json(profile);
});

// POST /profiles/:id/applications  { taskId }
// Links an existing Task to this profile as one of its applications.
// A task can only ever belong to one profile at a time (taskId is
// unique on the join table) — if it's already linked elsewhere, this
// fails with a clear error rather than silently double-linking it.
router.post('/:id/applications', requireAuth, async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId is required.' });
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) return res.status(404).json({ error: 'That task does not exist.' });
  const profile = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  const existingLink = await prisma.candidateProfileApplication.findUnique({ where: { taskId } });
  if (existingLink) {
    if (existingLink.profileId === req.params.id) {
      return res.status(409).json({ error: 'This application is already attached to this profile.' });
    }
    return res.status(409).json({ error: 'This application is already attached to a different profile. Detach it there first if you want to move it.' });
  }
  const link = await prisma.candidateProfileApplication.create({
    data: { profileId: req.params.id, taskId, addedById: req.user.id },
  });
  res.json(link);
});

// DELETE /profiles/:profileId/applications/:taskId
// Detaches the application from this profile. Does NOT delete the Task
// itself — the task keeps existing and working exactly as it does today,
// it just no longer shows up grouped under this profile.
router.delete('/:profileId/applications/:taskId', requireAuth, async (req, res) => {
  const link = await prisma.candidateProfileApplication.findUnique({ where: { taskId: req.params.taskId } });
  if (!link || link.profileId !== req.params.profileId) {
    return res.status(404).json({ error: 'That application is not attached to this profile.' });
  }
  await prisma.candidateProfileApplication.delete({ where: { id: link.id } });
  res.json({ ok: true });
});

// POST /profiles/merge  { keepProfileId, mergeProfileId }
// Manual merge tool for the case this feature exists to solve: two
// separate profiles turn out to be the same person. Moves every
// application from mergeProfileId onto keepProfileId, then deletes the
// now-empty mergeProfileId. Nothing about any Task is touched — only the
// join rows move.
router.post('/merge', requireAuth, async (req, res) => {
  const { keepProfileId, mergeProfileId } = req.body || {};
  if (!keepProfileId || !mergeProfileId || keepProfileId === mergeProfileId) {
    return res.status(400).json({ error: 'keepProfileId and mergeProfileId are required and must differ.' });
  }
  const [keep, merge] = await Promise.all([
    prisma.candidateProfile.findUnique({ where: { id: keepProfileId } }),
    prisma.candidateProfile.findUnique({ where: { id: mergeProfileId } }),
  ]);
  if (!keep || !merge) return res.status(404).json({ error: 'One of the profiles was not found.' });
  await prisma.candidateProfileApplication.updateMany({
    where: { profileId: mergeProfileId },
    data: { profileId: keepProfileId },
  });
  await prisma.candidateProfile.delete({ where: { id: mergeProfileId } });
  res.json(await attachApplications(keep));
});

module.exports = router;
