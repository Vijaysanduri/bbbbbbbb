const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { deliverPartnerAgreement } = require('../utils/partnerAgreementDelivery');
const { sendMail } = require('../utils/mailer');
const { logPartnerComment } = require('../utils/partnerCommentLog');

const router = express.Router();
const prisma = new PrismaClient();

// Every field a completed profile needs, besides the two document
// uploads (checked separately) — used both to decide "is this done yet"
// and to build a clear "here's what's still missing" list for reminder
// emails and the frontend's own progress display.
const REQUIRED_TEXT_FIELDS = [
  ['firstName', 'First name'],
  ['surname', 'Surname'],
  ['bankAccountHolderName', 'Bank account holder name'],
  ['bankAccountNumber', 'Bank account number'],
  ['bankIfscCode', 'Bank IFSC code'],
  ['bankName', 'Bank name'],
  ['emergencyContactName', 'Emergency contact name'],
  ['emergencyContactPhone', 'Emergency contact phone'],
];

function missingFields(profile) {
  const missing = REQUIRED_TEXT_FIELDS.filter(([key]) => !profile[key] || !profile[key].trim()).map(([, label]) => label);
  if (!profile.panCardFileData || profile.panCardStatus === 'REJECTED') missing.push('PAN card');
  if (!profile.aadharCardFileData || profile.aadharCardStatus === 'REJECTED') missing.push('Aadhar card');
  return missing;
}

// Creates an empty profile row the first time it's needed, so every
// other endpoint can assume one already exists rather than juggling
// upsert logic everywhere it's touched.
async function getOrCreateProfile(userId) {
  let profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile) profile = await prisma.partnerProfile.create({ data: { userId } });
  return profile;
}

// If every required field and both documents are now present, and this
// hasn't already been marked complete, marks it complete and sends the
// agreement automatically — this is the one place that decision gets
// made, called after every save/upload endpoint below rather than
// duplicating the check in each of them.
async function checkCompletionAndMaybeSendAgreement(profile) {
  if (profile.submittedAt) return profile; // already handled once — never re-trigger on a later edit
  if (missingFields(profile).length > 0) return profile;

  // Admin may have already manually sent an agreement before the
  // partner finished their profile — without this check, completing
  // the form afterward would trigger a second, duplicate agreement on
  // top of the one already sent.
  const existingAgreement = await prisma.signableDocument.findFirst({
    where: { targetUserId: profile.userId, category: 'AGREEMENT' },
  });

  const updated = await prisma.partnerProfile.update({ where: { id: profile.id }, data: { submittedAt: new Date() } });
  await logPartnerComment(profile.userId, 'Profile marked complete — all required fields and both documents submitted.');

  // Confirmation emails - one to the partner confirming their submission
  // went through, one notifying every active admin so they don't need
  // to keep checking the Onboarding Form page to find out. Both fire
  // exactly once, right alongside the agreement, guarded by the same
  // submittedAt check above - can't double-send on a later profile edit.
  const partnerUser = await prisma.user.findUnique({ where: { id: profile.userId }, select: { fullName: true, email: true } });
  try {
    await sendMail({
      to: partnerUser.email,
      subject: 'Your Channel Partner profile is complete',
      body: `Hi ${partnerUser.fullName},\n\nYour profile is now complete — thank you for filling everything in. Your Channel Partner Agreement is on its way to your portal to review and sign.\n\nBest,\nDream2Fly Team`,
    });
  } catch (err) {
    console.error('[partner-profile] Submission confirmation email to partner failed:', err.message);
  }
  try {
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
    for (const admin of admins) {
      await sendMail({
        to: admin.email,
        subject: `Channel Partner profile completed — ${partnerUser.fullName}`,
        body: `${partnerUser.fullName} has just completed their Channel Partner onboarding profile.\n\nView their full details from Admin -> Channel Partners -> View Profile.`,
      });
    }
  } catch (err) {
    console.error('[partner-profile] Submission notification email to admins failed:', err.message);
  }

  if (existingAgreement) {
    await logPartnerComment(profile.userId, 'Agreement was already on file — not re-sent automatically.');
    return updated;
  }

  const displayName = `${profile.firstName} ${profile.surname}`.trim();
  try {
    await deliverPartnerAgreement(profile.userId, { displayName });
    await logPartnerComment(profile.userId, 'Agreement automatically generated and sent to portal + email.');
  } catch (err) {
    // Profile completion itself still succeeded even if the agreement
    // send hit a problem — don't let a delivery failure make it look
    // like the partner's own submission failed.
    console.error('[partner-profile] Agreement auto-send failed after profile completion:', err.message);
    await logPartnerComment(profile.userId, 'Agreement auto-send FAILED after profile completion: ' + err.message);
  }
  return updated;
}

// GET /api/partner-profile/me — the logged-in partner's own profile,
// with their real phone/email pulled in from their account (read-only
// on the frontend — those aren't editable here, just shown for
// confirmation) rather than needing to be retyped.
router.get('/me', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const profile = await getOrCreateProfile(req.user.id);
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { phone: true, email: true } });
  res.json({ ...profile, accountPhone: user.phone, accountEmail: user.email, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});

// PATCH /api/partner-profile/me — save the text fields. Can be called
// multiple times before submission (partner filling the form in over
// more than one visit) — completion is only ever evaluated by whether
// every required field is actually present at the time this runs, not
// by whether this is "the submit click" specifically.
router.patch('/me', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { firstName, surname, bankAccountHolderName, bankAccountNumber, bankIfscCode, bankName, emergencyContactName, emergencyContactPhone, emergencyContactRelation, customValues } = req.body;
  let profile = await getOrCreateProfile(req.user.id);
  profile = await prisma.partnerProfile.update({
    where: { id: profile.id },
    data: {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(surname !== undefined ? { surname } : {}),
      ...(bankAccountHolderName !== undefined ? { bankAccountHolderName } : {}),
      ...(bankAccountNumber !== undefined ? { bankAccountNumber } : {}),
      ...(bankIfscCode !== undefined ? { bankIfscCode } : {}),
      ...(bankName !== undefined ? { bankName } : {}),
      ...(emergencyContactName !== undefined ? { emergencyContactName } : {}),
      ...(emergencyContactPhone !== undefined ? { emergencyContactPhone } : {}),
      ...(emergencyContactRelation !== undefined ? { emergencyContactRelation } : {}),
      ...(customValues !== undefined ? { customValues } : {}),
    },
  });
  profile = await checkCompletionAndMaybeSendAgreement(profile);
  res.json({ ...profile, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});

// POST /api/partner-profile/me/pan and /aadhar — Body: { fileName, mimeType, fileData }
router.post('/me/pan', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { fileName, mimeType, fileData } = req.body;
  if (!fileName || !fileData) return res.status(400).json({ error: 'fileName and fileData are required.' });
  let profile = await getOrCreateProfile(req.user.id);
  profile = await prisma.partnerProfile.update({ where: { id: profile.id }, data: { panCardFileName: fileName, panCardFileData: fileData, panCardStatus: 'PENDING', panCardRejectionReason: null } });
  profile = await checkCompletionAndMaybeSendAgreement(profile);
  res.json({ ...profile, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});
router.post('/me/aadhar', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { fileName, mimeType, fileData } = req.body;
  if (!fileName || !fileData) return res.status(400).json({ error: 'fileName and fileData are required.' });
  let profile = await getOrCreateProfile(req.user.id);
  profile = await prisma.partnerProfile.update({ where: { id: profile.id }, data: { aadharCardFileName: fileName, aadharCardFileData: fileData, aadharCardStatus: 'PENDING', aadharCardRejectionReason: null } });
  profile = await checkCompletionAndMaybeSendAgreement(profile);
  res.json({ ...profile, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});

// GET /api/partner-profile/:userId — Admin/Super Admin only. Full view
// of a specific partner's profile, including their two documents and
// any extra attachments admin has added.
router.get('/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const profile = await prisma.partnerProfile.findUnique({
    where: { userId: req.params.userId },
    include: { extraAttachments: { include: { uploadedBy: { select: { fullName: true } } } } },
  });
  if (!profile) return res.json({ userId: req.params.userId, missingFields: REQUIRED_TEXT_FIELDS.map(([, l]) => l).concat(['PAN card', 'Aadhar card']), isComplete: false, extraAttachments: [] });
  res.json({ ...profile, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});

// Shared by all 4 approve/reject endpoints below, so PAN and Aadhar
// stay behaviorally identical rather than risking two slightly-drifted
// copies of the same logic.
const DOC_LABELS = { pan: 'PAN card', aadhar: 'Aadhar card' };
async function reviewPartnerDocument(req, res, docType, decision) {
  const statusField = docType + 'CardStatus';
  const reasonField = docType + 'CardRejectionReason';
  const profile = await prisma.partnerProfile.findUnique({ where: { userId: req.params.userId } });
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  let updateData;
  if (decision === 'APPROVED') {
    updateData = { [statusField]: 'APPROVED', [reasonField]: null };
  } else {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'A rejection reason is required.' });
    updateData = { [statusField]: 'REJECTED', [reasonField]: reason.trim() };
  }
  const updated = await prisma.partnerProfile.update({ where: { id: profile.id }, data: updateData });

  if (decision === 'APPROVED') {
    await logPartnerComment(req.params.userId, `${DOC_LABELS[docType]} approved.`, req.user.id);
  } else {
    await logPartnerComment(req.params.userId, `${DOC_LABELS[docType]} rejected — reason: ${req.body.reason.trim()}`, req.user.id);
  }

  if (decision === 'REJECTED') {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (user) {
      sendMail({
        to: user.email,
        subject: `Please re-upload your ${DOC_LABELS[docType]}`,
        body: `Hi ${user.fullName},\n\nWe reviewed the ${DOC_LABELS[docType]} you submitted and it couldn't be accepted: ${req.body.reason.trim()}\n\nPlease log in to your portal and upload a corrected copy.\n\nBest,\nDream2Fly Team`,
      }).catch(err => console.error(`[partner-profile] ${docType} rejection email failed:`, err.message));
    }
  }
  res.json({ ...updated, missingFields: missingFields(updated), isComplete: !!updated.submittedAt });
}
router.post('/:userId/pan/approve', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => reviewPartnerDocument(req, res, 'pan', 'APPROVED'));
router.post('/:userId/pan/reject', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => reviewPartnerDocument(req, res, 'pan', 'REJECTED'));
router.post('/:userId/aadhar/approve', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => reviewPartnerDocument(req, res, 'aadhar', 'APPROVED'));
router.post('/:userId/aadhar/reject', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => reviewPartnerDocument(req, res, 'aadhar', 'REJECTED'));

// POST /api/partner-profile/:userId/attachments — Admin/Super Admin
// only. Body: { fileName, mimeType, fileData }
router.post('/:userId/attachments', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { fileName, mimeType, fileData } = req.body;
  if (!fileName || !fileData) return res.status(400).json({ error: 'fileName and fileData are required.' });
  const profile = await getOrCreateProfile(req.params.userId);
  const attachment = await prisma.partnerProfileAttachment.create({
    data: { profileId: profile.id, fileName, mimeType: mimeType || 'application/octet-stream', fileData, uploadedById: req.user.id },
  });
  res.status(201).json(attachment);
});

// POST /api/partner-profile/:userId/send-reminder — Admin/Super Admin
// only. Manually fires the same reminder a partner would otherwise only
// get from the weekly scheduled check - for when you don't want to
// wait for that cycle. Blocked if the profile is already complete,
// since there'd be nothing left to remind them about.
router.post('/:userId/send-reminder', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user || user.role !== 'CHANNEL_PARTNER') return res.status(404).json({ error: 'Partner account not found.' });
  // getOrCreateProfile (not a plain findUnique) - a partner who's never
  // opened their Onboarding Form yet has no PartnerProfile row at all,
  // but is still a completely legitimate partner worth reminding, not
  // an error case.
  const profile = await getOrCreateProfile(req.params.userId);
  if (profile.submittedAt) return res.status(400).json({ error: 'This profile is already complete — nothing to remind them about.' });
  try {
    await sendMail({
      to: user.email,
      subject: `Reminder: please complete your Channel Partner profile`,
      body: `Hi ${user.fullName},\n\nYour profile still needs a few details before we can send your Channel Partner Agreement — please complete it from your portal.\n\nBest,\nDream2Fly Team`,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Could not send the reminder email: ' + err.message });
  }
  const updated = await prisma.partnerProfile.update({
    where: { id: profile.id },
    data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
  });
  await logPartnerComment(req.params.userId, 'Reminder email sent manually.', req.user.id);
  res.json({ reminderCount: updated.reminderCount, lastReminderAt: updated.lastReminderAt });
});

// GET /api/partner-profile/:userId/comments — Admin/Super Admin only.
// The full activity thread for this partner - automated system entries
// (agreements/certificates/reminders sent, documents approved/rejected)
// mixed with any manual notes admin has added, newest first.
router.get('/:userId/comments', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const comments = await prisma.comment.findMany({
    where: { partnerId: req.params.userId },
    include: { author: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(comments);
});

// GET /api/partner-profile/:userId/comments/export — Admin/Super Admin
// only. Same plain-text export pattern used for Task comments/
// confidential notes, newest first.
router.get('/:userId/comments/export', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const partner = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });
  const comments = await prisma.comment.findMany({
    where: { partnerId: req.params.userId },
    include: { author: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const lines = [`Activity & Comments — ${partner.fullName}`, '='.repeat(50), ''];
  comments.forEach(c => {
    const ts = c.createdAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const who = (c.author && c.author.fullName) || (c.isSystem ? 'System' : 'Unknown');
    lines.push(`[${ts} — ${who}${c.isSystem ? ' — automatic' : ''}]`);
    lines.push(c.text || '(attachment only)');
    lines.push('');
  });
  if (!comments.length) lines.push('No comments on record.');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="comments-${partner.fullName.replace(/[^a-z0-9]+/gi, '-')}.txt"`);
  res.send(lines.join('\n'));
});

// POST /api/partner-profile/:userId/comments — Admin/Super Admin only.
// Adds a manual note to the same thread - isSystem: false distinguishes
// this from the automated entries logged elsewhere in this file.
router.post('/:userId/comments', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Please enter a note before saving.' });
  const comment = await prisma.comment.create({
    data: { partnerId: req.params.userId, text: text.trim(), isSystem: false, channel: 'INTERNAL', authorId: req.user.id },
    include: { author: { select: { fullName: true } } },
  });
  res.status(201).json(comment);
});

module.exports = router;
