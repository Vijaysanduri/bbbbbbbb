const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');
const { createTempViewToken, consumeTempViewToken, deleteTempViewToken } = require('../utils/tempViewLinks');
const { generateSignatureCertificatePdf } = require('../utils/signatureCertificatePdf');
const { checkAndSendCertificateIfEligible } = require('../utils/partnerCertificateDelivery');

// The backend's own public URL — this route is fetched directly by
// Google's document viewer service, not through the frontend, so it
// needs the actual API domain, not dream2fly.co.uk.
const API_BASE_URL = process.env.API_PUBLIC_URL || 'https://bbbbbbbb-production.up.railway.app';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/signable-documents — Admin/HR/Super Admin only. Every document,
// with a completion count so it's clear at a glance who's still pending.
// GET /api/signable-documents/submissions — Admin/HR/Super Admin only.
// A flat, reviewable queue of every actual submission (signed or
// uploaded) across every document, not grouped by document template —
// this is what Admin actually needs to work through when there are many
// people to review, rather than clicking into each document one at a
// time. Supports filtering by name, role, date range, and review status.
router.get('/submissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { name, role, from, to, reviewStatus } = req.query;
  const acks = await prisma.signableDocumentAck.findMany({
    where: {
      OR: [{ signedAt: { not: null } }, { uploadedFileData: { not: null } }],
      ...(reviewStatus === 'PENDING' ? { reviewStatus: null } : reviewStatus ? { reviewStatus } : {}),
      ...(role ? { user: { is: { role } } } : {}),
      ...(name ? { user: { is: { fullName: { contains: name } } } } : {}),
    },
    include: {
      user: { select: { id: true, fullName: true, role: true } },
      document: { select: { id: true, title: true, category: true } },
      reviewedBy: { select: { fullName: true } },
    },
    orderBy: [{ signedAt: 'desc' }, { uploadedAt: 'desc' }],
  });
  // Date filtering applied in JS rather than the query above, since
  // "submitted" means whichever of signedAt/uploadedAt is actually set,
  // and Prisma can't easily express "whichever of these two is
  // non-null, filter by that one" in a single where clause.
  const filtered = acks.filter(a => {
    const submittedAt = a.signedAt || a.uploadedAt;
    if (from && submittedAt < new Date(from)) return false;
    if (to && submittedAt > new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000)) return false;
    return true;
  });
  res.json(filtered.map(a => ({
    documentId: a.documentId, userId: a.userId, title: a.document.title, category: a.document.category,
    userName: a.user.fullName, userRole: a.user.role,
    signedByTypedName: a.signedByTypedName, signedAt: a.signedAt,
    uploadedFileName: a.uploadedFileName, uploadedAt: a.uploadedAt,
    hasUpload: !!a.uploadedFileData,
    reviewStatus: a.reviewStatus, reviewedAt: a.reviewedAt, reviewedByName: a.reviewedBy ? a.reviewedBy.fullName : null,
    rejectionReason: a.rejectionReason,
  })));
});

// POST /api/signable-documents/:id/acks/:userId/approve — Admin/HR only.
router.post('/:id/acks/:userId/approve', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const ack = await prisma.signableDocumentAck.update({
    where: { documentId_userId: { documentId: req.params.id, userId: req.params.userId } },
    data: { reviewStatus: 'APPROVED', reviewedAt: new Date(), reviewedById: req.user.id, rejectionReason: null },
  });
  res.json(ack);
});

// POST /api/signable-documents/:id/acks/:userId/reject — Admin/HR only.
// Body: { reason }. Clears their signature/upload entirely, so their own
// dashboard immediately shows this as pending again — not silently, the
// reason is stored and emailed to them so they know what to fix.
router.post('/:id/acks/:userId/reject', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Please give a reason so the person knows what to fix.' });
  const [ack, doc] = await Promise.all([
    prisma.signableDocumentAck.update({
      where: { documentId_userId: { documentId: req.params.id, userId: req.params.userId } },
      data: {
        reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedById: req.user.id, rejectionReason: reason,
        signedByTypedName: null, signedAt: null, uploadedFileData: null, uploadedFileName: null, uploadedAt: null,
      },
    }),
    prisma.signableDocument.findUnique({ where: { id: req.params.id } }),
  ]);
  const person = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (person) {
    await sendMail({
      to: person.email,
      subject: `Action needed: "${doc.title}" needs to be resubmitted`,
      body: `Hi ${person.fullName},\n\nYour submission for "${doc.title}" needs another look before it can be accepted:\n\n"${reason}"\n\nPlease sign or upload it again from your portal.\n\nBest,\nDream2Fly`,
    });
  }
  await logActivity(`${req.user.fullName} rejected ${person ? person.fullName : 'a submission'}'s "${doc.title}" — asked to resubmit.`, req.user.id);
  res.json(ack);
});

router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const docs = await prisma.signableDocument.findMany({
    include: { acknowledgments: true },
    orderBy: { createdAt: 'desc' },
  });
  const withCounts = docs.map(d => ({
    id: d.id, title: d.title, category: d.category, description: d.description,
    fileName: d.fileName, mimeType: d.mimeType, createdAt: d.createdAt, targetRole: d.targetRole, active: d.active,
    signedCount: d.acknowledgments.filter(a => a.signedAt || a.uploadedFileData).length,
    totalCount: d.acknowledgments.length,
  }));
  res.json(withCounts);
});

// POST /api/signable-documents — Admin/HR/Super Admin only.
// Body: { title, category, description, fileName, mimeType, fileData, targetRole }
// targetRole: "EMPLOYEE" (default — staff roles), "CHANNEL_PARTNER", "STUDENT", or "ALL"
router.post('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { title, category, description, fileName, mimeType, fileData, targetRole, targetUserId } = req.body;
  if (!title || !category || !fileName || !fileData) {
    return res.status(400).json({ error: 'title, category, fileName and fileData are required.' });
  }
  const resolvedTargetRole = ['EMPLOYEE', 'CHANNEL_PARTNER', 'STUDENT', 'ALL'].includes(targetRole) ? targetRole : 'EMPLOYEE';
  const doc = await prisma.signableDocument.create({
    data: { title, category, description: description || null, fileName, mimeType: mimeType || 'application/pdf', fileData, createdById: req.user.id, targetRole: resolvedTargetRole, targetUserId: targetUserId || null },
  });

  // Individually-assigned documents skip the broad role-based recipient
  // list entirely — this one goes to exactly the person picked, e.g.
  // a specific new hire's Employment Agreement, not every current
  // employee. targetRole is still saved for reference/filtering, but
  // ignored for recipient selection when targetUserId is set.
  let recipients;
  if (targetUserId) {
    const person = await prisma.user.findUnique({ where: { id: targetUserId } });
    recipients = person ? [person] : [];
  } else {
    const roleFilter = resolvedTargetRole === 'CHANNEL_PARTNER' ? ['CHANNEL_PARTNER']
      : resolvedTargetRole === 'STUDENT' ? ['STUDENT']
      : resolvedTargetRole === 'ALL' ? ['EMPLOYEE', 'COUNSELLOR', 'MANAGER', 'CHANNEL_PARTNER', 'STUDENT']
      : ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'];
    recipients = await prisma.user.findMany({ where: { active: true, role: { in: roleFilter } } });
  }
  for (const person of recipients) {
    await prisma.signableDocumentAck.create({ data: { documentId: doc.id, userId: person.id } });
    await sendMail({
      to: person.email,
      subject: `Action needed: ${doc.title}`,
      body: `Hi ${person.fullName},\n\nA new ${category === 'AGREEMENT' ? 'agreement' : 'document'} "${doc.title}" needs your signature. Please review and sign it from your portal.\n\nBest,\nDream2Fly HR`,
    });
  }
  res.status(201).json(doc);
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  await prisma.signableDocument.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// PATCH /api/signable-documents/:id — Admin/Super Admin/HR only.
// Body: any of { title, description, category, targetRole, active } —
// active:false removes it from recipients' own list without deleting the
// document or anyone's existing signature/upload records against it.
router.patch('/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { title, description, category, targetRole, active } = req.body;
  const doc = await prisma.signableDocument.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(targetRole !== undefined ? { targetRole } : {}),
      ...(active !== undefined ? { active: !!active } : {}),
    },
  });
  res.json(doc);
});

// GET /api/signable-documents/:id/status — Admin/HR/Super Admin only. Who
// has signed, who hasn't — the list you'd act on to send reminders.
router.get('/:id/status', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const acks = await prisma.signableDocumentAck.findMany({
    where: { documentId: req.params.id },
    include: { user: { select: { fullName: true, email: true } } },
  });
  res.json(acks);
});

// GET /api/signable-documents/for-user/:userId — Admin/HR/Super Admin
// only. Every document sent to one specific person, with their signing
// status on each — the missing link between "here's this partner's
// profile" and "here's whether they've actually signed their
// agreement, and when," without navigating away to hunt through the
// full documents list.
router.get('/for-user/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const acks = await prisma.signableDocumentAck.findMany({
    where: { userId: req.params.userId },
    include: { document: { select: { id: true, title: true, category: true } } },
    orderBy: { id: 'desc' },
  });
  res.json(acks);
});

// GET /api/signable-documents/:id/acks/:userId/certificate — Admin
// only. Generates a signature certificate on the fly for a typed-name
// signature — there's no separate uploaded file in that case, so this
// gives admin something concrete to view/download either way someone
// signs, rather than only a line of status text.
router.get('/:id/acks/:userId/certificate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const ack = await prisma.signableDocumentAck.findUnique({
    where: { documentId_userId: { documentId: req.params.id, userId: req.params.userId } },
    include: { user: true, document: true },
  });
  if (!ack) return res.status(404).json({ error: 'Not found.' });
  if (!ack.signedByTypedName) return res.status(400).json({ error: 'This was not signed by typed name.' });

  const pdfBuffer = await generateSignatureCertificatePdf({
    documentTitle: ack.document.title,
    signerName: ack.user.fullName,
    signerEmail: ack.user.email,
    typedName: ack.signedByTypedName,
    signedAt: ack.signedAt,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Signature-Certificate-${ack.user.fullName.replace(/\s+/g, '-')}.pdf"`);
  res.send(pdfBuffer);
});

// POST /api/signable-documents/:id/remind/:userId — Admin/HR/Super Admin
// only. Manually sends one reminder email (see schema note: no automatic
// recurring scheduler exists here).
router.post('/:id/remind/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const doc = await prisma.signableDocument.findUnique({ where: { id: req.params.id } });
  const ack = await prisma.signableDocumentAck.findUnique({
    where: { documentId_userId: { documentId: req.params.id, userId: req.params.userId } },
    include: { user: true },
  });
  if (!doc || !ack) return res.status(404).json({ error: 'Not found.' });
  await sendMail({
    to: ack.user.email,
    subject: `Reminder: please sign "${doc.title}"`,
    body: `Hi ${ack.user.fullName},\n\nThis is a reminder that "${doc.title}" is still awaiting your signature. Please complete it from your employee portal.\n\nBest,\nDream2Fly HR`,
  });
  const updated = await prisma.signableDocumentAck.update({
    where: { id: ack.id },
    data: { remindersSentCount: { increment: 1 }, lastReminderAt: new Date() },
  });
  res.json(updated);
});

// GET /api/signable-documents/me — the signed-in employee's own list,
// each showing whether they've completed it yet.
router.get('/me', requireAuth, async (req, res) => {
  const acks = await prisma.signableDocumentAck.findMany({
    where: { userId: req.user.id, document: { active: true } },
    include: { document: true },
    orderBy: { id: 'desc' },
  });
  res.json(acks);
});

// POST /api/signable-documents/:id/sign — the signed-in employee only.
// Body: { typedName }
router.post('/:id/sign', requireAuth, async (req, res) => {
  const { typedName } = req.body;
  if (!typedName) return res.status(400).json({ error: 'typedName is required.' });
  const ack = await prisma.signableDocumentAck.findUnique({
    where: { documentId_userId: { documentId: req.params.id, userId: req.user.id } },
  });
  if (!ack) return res.status(404).json({ error: 'Document not found for you.' });
  const updated = await prisma.signableDocumentAck.update({
    where: { id: ack.id },
    data: { signedByTypedName: typedName, signedAt: new Date() },
  });
  const doc = await prisma.signableDocument.findUnique({ where: { id: req.params.id } });
  await logActivity(`${req.user.fullName} signed "${doc.title}".`, req.user.id);
  try {
    await checkAndSendCertificateIfEligible(req.user.id, doc.category);
  } catch (err) {
    console.error('[signableDocuments] Certificate auto-send failed after signing:', err.message);
  }
  res.json(updated);
});

// POST /api/signable-documents/:id/upload — the signed-in employee only.
// Body: { fileData, fileName } — a scanned physically-signed copy instead.
router.post('/:id/upload', requireAuth, async (req, res) => {
  const { fileData, fileName } = req.body;
  if (!fileData || !fileName) return res.status(400).json({ error: 'fileData and fileName are required.' });
  const ack = await prisma.signableDocumentAck.findUnique({
    where: { documentId_userId: { documentId: req.params.id, userId: req.user.id } },
  });
  if (!ack) return res.status(404).json({ error: 'Document not found for you.' });
  const updated = await prisma.signableDocumentAck.update({
    where: { id: ack.id },
    data: { uploadedFileData: fileData, uploadedFileName: fileName, uploadedAt: new Date() },
  });
  const doc = await prisma.signableDocument.findUnique({ where: { id: req.params.id } });
  await logActivity(`${req.user.fullName} uploaded a signed copy of "${doc.title}".`, req.user.id);
  try {
    await checkAndSendCertificateIfEligible(req.user.id, doc.category);
  } catch (err) {
    console.error('[signableDocuments] Certificate auto-send failed after upload:', err.message);
  }
  res.json(updated);
});

// GET /api/signable-documents/:id/download — the template file, for
// anyone signed in who has an ack record for it (or Admin/HR/Super Admin).
router.get('/:id/download', requireAuth, async (req, res) => {
  const doc = await prisma.signableDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'HR'].includes(req.user.role);
  if (!isStaff) {
    const ack = await prisma.signableDocumentAck.findUnique({
      where: { documentId_userId: { documentId: doc.id, userId: req.user.id } },
    });
    if (!ack) return res.status(403).json({ error: 'Not authorized.' });
    // If they uploaded their own physically-signed copy, that's what
    // "View Document" should actually show them — otherwise it always
    // displays the original unsigned template even after completion,
    // which looks like the signature was never captured at all.
    if (ack.uploadedFileData) {
      await logActivity(`${req.user.fullName} viewed their signed copy of "${doc.title}".`, req.user.id);
      return res.json({ ...doc, fileData: ack.uploadedFileData, fileName: ack.uploadedFileName || doc.fileName });
    }
  }
  await logActivity(`${req.user.fullName} downloaded "${doc.title}".`, req.user.id);
  res.json(doc);
});

// POST /:id/temp-view-link — same access rules as the download route
// above, but instead of returning the file itself, returns a short-lived
// token good for one fetch within 5 minutes. Used for file types
// browsers can't render natively (Word, Excel) — the frontend hands the
// resulting URL to Google's public document viewer, which needs to
// fetch it without auth headers of its own.
router.post('/:id/temp-view-link', requireAuth, async (req, res) => {
  const doc = await prisma.signableDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Not found.' });
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'HR'].includes(req.user.role);
  if (!isStaff) {
    const ack = await prisma.signableDocumentAck.findUnique({
      where: { documentId_userId: { documentId: doc.id, userId: req.user.id } },
    });
    if (!ack) return res.status(403).json({ error: 'Not authorized.' });
  }
  const token = createTempViewToken(doc.fileData, doc.fileName, doc.mimeType);
  res.json({ token, url: `${API_BASE_URL}/api/signable-documents/temp-view/${token}` });
});

// GET /temp-view/:token — deliberately NOT behind requireAuth. Google's
// viewer service fetches this directly and can't send an Authorization
// header, so the token itself — random, single-use, 5-minute expiry —
// is what stands in for authentication here, not a login session.
router.get('/temp-view/:token', async (req, res) => {
  const entry = consumeTempViewToken(req.params.token);
  if (!entry) return res.status(404).send('This link has expired or was already used.');
  const buffer = Buffer.from(entry.fileData, 'base64');
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${entry.fileName}"`);
  res.send(buffer);
  deleteTempViewToken(req.params.token);
});

// POST /:id/acks/:userId/temp-view-link — Admin/HR/Super Admin only.
// Same short-lived-token approach as above, but for the uploaded signed
// copy a specific person submitted, not the original template file.
router.post('/:id/acks/:userId/temp-view-link', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const ack = await prisma.signableDocumentAck.findUnique({
    where: { documentId_userId: { documentId: req.params.id, userId: req.params.userId } },
  });
  if (!ack || !ack.uploadedFileData) return res.status(404).json({ error: 'No uploaded file found.' });
  const mimeType = (ack.uploadedFileData.match(/^data:([^;]+);/) || [])[1] || 'application/octet-stream';
  const rawBase64 = ack.uploadedFileData.split(',')[1] || ack.uploadedFileData;
  const token = createTempViewToken(rawBase64, ack.uploadedFileName || 'uploaded-file', mimeType);
  res.json({ token, url: `${API_BASE_URL}/api/signable-documents/temp-view/${token}` });
});

module.exports = router;
