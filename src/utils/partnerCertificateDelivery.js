const { PrismaClient } = require('@prisma/client');
const { generatePartnerCertificatePdf } = require('./partnerCertificatePdf');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

// Called after a document sign/upload completes. Only actually does
// anything if all three are true: the signer is a Channel Partner, the
// document they just signed is their Agreement, and their profile is
// already complete — matching the sequence "form + documents +
// agreement all done" the certificate is meant to confirm. Fires once;
// certificateSentAt prevents it firing again on a later, unrelated
// document sign.
async function checkAndSendCertificateIfEligible(userId, documentCategory) {
  if (documentCategory !== 'AGREEMENT') return;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'CHANNEL_PARTNER') return;

  const profile = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (!profile || !profile.submittedAt || profile.certificateSentAt) return;

  // Use the verified name from their completed profile — the whole
  // point of asking for firstName/surname there was to have a name
  // that's actually been confirmed correct, not whatever they typed at
  // registration.
  const displayName = `${profile.firstName} ${profile.surname}`.trim();

  const pdfBuffer = await generatePartnerCertificatePdf({
    partnerName: displayName,
    partnerId: user.id.slice(-8).toUpperCase(),
    issueDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
  });

  await prisma.partnerProfile.update({ where: { id: profile.id }, data: { certificateSentAt: new Date() } });

  await sendMail({
    to: user.email,
    subject: 'Your Dream2Fly Channel Partner Certificate',
    body: `Hi ${displayName},\n\nCongratulations — your profile and Channel Partner Agreement are both complete. Your official Certificate is attached.\n\nWelcome aboard.\n\nBest,\nDream2Fly Team`,
    attachmentFileName: `Dream2Fly-Partner-Certificate-${displayName.replace(/\s+/g, '-')}.pdf`,
    attachmentBase64: pdfBuffer.toString('base64'),
    attachmentMimeType: 'application/pdf',
  });
}

module.exports = { checkAndSendCertificateIfEligible };
