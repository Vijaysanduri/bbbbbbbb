const { PrismaClient } = require('@prisma/client');
const { generatePartnerAgreementPdf } = require('./partnerAgreementPdf');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

// Shared by both paths that can send a partner their agreement: the
// manual "Send Agreement" button in admin, and the automatic trigger
// once a partner finishes their profile form. Kept as one function so
// the two paths can never drift apart from each other.
//
// displayName lets the caller use the more deliberately-confirmed
// firstName+surname from a completed PartnerProfile instead of the
// account's original (possibly informal or incomplete) fullName —
// falls back to fullName when no override is given.
async function deliverPartnerAgreement(partnerId, { businessName, effectiveDate, responseDeadline, displayName, createdById } = {}) {
  const partner = await prisma.user.findUnique({ where: { id: partnerId } });
  if (!partner) throw new Error('Partner not found.');
  if (partner.role !== 'CHANNEL_PARTNER') throw new Error('Agreements are only for Channel Partner accounts.');

  const name = displayName || partner.fullName;

  // Whatever's currently saved in the editable template (Channel
  // Partners → ✏️ Edit Agreement Template) is used if it exists;
  // generatePartnerAgreementPdf falls back to its own hardcoded default
  // wording if nothing's been saved yet, so this never fails just
  // because the template row doesn't exist.
  const savedTemplate = await prisma.partnerAgreementTemplate.findUnique({ where: { id: 'default' } });

  const pdfBuffer = await generatePartnerAgreementPdf({
    partnerName: name,
    partnerId: partner.id.slice(-8).toUpperCase(),
    partnerEmail: partner.email,
    partnerPhone: partner.phone,
    partnerAddress: partner.currentAddress || '',
    businessName: businessName || '',
    effectiveDate: effectiveDate || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    responseDeadline: responseDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    introText: savedTemplate ? savedTemplate.introText : undefined,
    // Stored as [{ title, text }, ...] (friendlier shape for the admin
    // edit screen's JSON); generatePartnerAgreementPdf expects
    // [[title, text], ...] pairs — converted here at the boundary so
    // neither side has to know about the other's preferred shape.
    clauses: savedTemplate ? savedTemplate.clauses.map(c => [c.title, c.text]) : undefined,
  });

  const fileName = `Channel-Partner-Agreement-${name.replace(/\s+/g, '-')}.pdf`;
  const doc = await prisma.signableDocument.create({
    data: {
      title: `Channel Partner Agreement — ${name}`,
      category: 'AGREEMENT',
      description: 'Auto-generated from the current agreement template — please review and sign.',
      fileName,
      mimeType: 'application/pdf',
      fileData: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      createdById: createdById || null,
      targetRole: 'CHANNEL_PARTNER',
      targetUserId: partner.id,
    },
  });
  await prisma.signableDocumentAck.create({ data: { documentId: doc.id, userId: partner.id } });
  try {
    await sendMail({
      to: partner.email,
      subject: `Action needed: ${doc.title}`,
      body: `Hi ${name},\n\nYour Channel Partner Agreement is attached, and also ready for review and signature from your portal.\n\nBest,\nDream2Fly Team`,
      attachmentFileName: fileName,
      attachmentBase64: pdfBuffer.toString('base64'),
      attachmentMimeType: 'application/pdf',
    });
  } catch (err) {
    // The document itself and its portal entry already exist by this
    // point - a failed email just means the partner didn't get a copy
    // in their inbox, not that the agreement wasn't actually delivered.
    console.error(`[partner-agreement] Email failed for partner ${partner.id}:`, err.message);
  }

  return doc;
}

module.exports = { deliverPartnerAgreement };
