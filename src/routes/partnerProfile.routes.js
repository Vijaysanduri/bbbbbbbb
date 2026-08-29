const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { deliverPartnerAgreement } = require('../utils/partnerAgreementDelivery');
const { sendMail } = require('../utils/mailer');

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
  if (!profile.panCardFileData) missing.push('PAN card');
  if (!profile.aadharCardFileData) missing.push('Aadhar card');
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
  if (existingAgreement) return updated;

  const displayName = `${profile.firstName} ${profile.surname}`.trim();
  try {
    await deliverPartnerAgreement(profile.userId, { displayName });
  } catch (err) {
    // Profile completion itself still succeeded even if the agreement
    // send hit a problem — don't let a delivery failure make it look
    // like the partner's own submission failed.
    console.error('[partner-profile] Agreement auto-send failed after profile completion:', err.message);
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
  const { firstName, surname, bankAccountHolderName, bankAccountNumber, bankIfscCode, bankName, emergencyContactName, emergencyContactPhone, emergencyContactRelation } = req.body;
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
  profile = await prisma.partnerProfile.update({ where: { id: profile.id }, data: { panCardFileName: fileName, panCardFileData: fileData } });
  profile = await checkCompletionAndMaybeSendAgreement(profile);
  res.json({ ...profile, missingFields: missingFields(profile), isComplete: !!profile.submittedAt });
});
router.post('/me/aadhar', requireAuth, requireRole('CHANNEL_PARTNER'), async (req, res) => {
  const { fileName, mimeType, fileData } = req.body;
  if (!fileName || !fileData) return res.status(400).json({ error: 'fileName and fileData are required.' });
  let profile = await getOrCreateProfile(req.user.id);
  profile = await prisma.partnerProfile.update({ where: { id: profile.id }, data: { aadharCardFileName: fileName, aadharCardFileData: fileData } });
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

module.exports = router;
