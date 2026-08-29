const PDFDocument = require('pdfkit');
const { HEADER_BASE64, FOOTER_BASE64, SIGNATURE_BASE64, STAMP_BASE64 } = require('./partnerAgreementAssets');

const NAVY = '#0b1f4d';
const GRAY = '#888888';

const CLAUSES = [
  ['1. Purpose', 'The Partner will refer prospective Candidates to the Company for study-abroad and related services. This Agreement sets out the basis on which such referrals are handled, and the basis on which commission is earned and paid for successful referrals.'],
  ['2. Candidate Financial Matters', "Where the Company itself collects any payment directly from a Candidate, that payment shall be received into the Company's official account only, and a clear written acknowledgment (receipt) shall be issued to the Candidate for it. Where the Partner collects any payment directly from a Candidate, that arrangement is solely between the Partner and the Candidate; the Company is not a party to it and bears no responsibility or liability for it. The Partner shall not bring any claim, suit, or demand against the Company arising from money owed by, owed to, or disputed with a Candidate, and waives any right to do so."],
  ['3. Document Integrity', 'The Partner warrants that all documents, information, and representations submitted on behalf of a Candidate are genuine, accurate, and not fraudulently obtained or altered. The Partner shall not submit, or assist a Candidate in submitting, fake, forged, or materially misleading documents of any kind. The Company shall bear no responsibility or liability for a visa refusal, loan refusal, or any other adverse outcome, where such outcome arises from inaccurate, incomplete, or fraudulent documentation submitted in connection with a Candidate referred by the Partner.'],
  ['4. Processing Timelines', "The Partner acknowledges that the processing of a Candidate's study-abroad application, visa, or loan may be delayed for reasons outside the Company's control, including but not limited to immigration authority requirements and processing times, university or college admission and enrollment procedures, and other regulatory or third-party factors. The Company does not guarantee any specific timeline and shall not be liable for delays arising from such factors."],
  ['5. Commission and Payment', "Commission shall become payable to the Partner only where (a) the Candidate referred by the Partner has been granted a visa, and (b) a period of thirty (30) days has elapsed from the date the Candidate formally enrolls at the receiving university or institution. No commission shall accrue or become payable for a Candidate whose visa is refused, whose enrollment does not occur, or before the 30-day period described above has elapsed.\n\nCommission for an eligible Candidate shall range between Rs. 10,000 and Rs. 100,000, with the exact amount depending on the specific university and country of enrollment. No commission whatsoever is payable for enrollment at a public university, meaning a university or institution affiliated with, or funded by, a government. The Company's focus under this Agreement is primarily on privately-run universities and institutions, for which commission is payable in accordance with this clause. The applicable commission rate for each university and country is set out in the commission schedule provided separately to the Partner."],
  ['6. Termination', "The Company may terminate this Agreement at any time, with or without cause, and without prior notice, at its sole discretion. Upon termination, the Company shall settle any dues genuinely owed to the Partner in accordance with the Company's standard settlement policy and within the timelines set out in that policy. Termination of this Agreement does not affect commission already earned and payable under Clause 5 prior to the termination date."],
  ['7. Data Security and Defamation', 'The Partner shall not breach, misuse, or improperly disclose any data, confidential information, or systems belonging to the Company, and shall not make or publish any defamatory statement about the Company, whether such conduct occurs during the term of this Agreement or after it has ended for any reason. This clause survives the termination or expiry of this Agreement. The Company reserves the right to take legal action against the Partner for any breach of this clause, whenever that breach occurs.'],
  ['8. Governing Law', 'This Agreement shall be governed by the laws of [Governing Law / Jurisdiction — to be confirmed with legal counsel].'],
];

// Auto-fills a partner's real name, ID, email, phone, and address from
// their account — the only thing that can't be auto-filled is Business
// Name, since no such field exists anywhere in the data model; that one
// piece is asked for once at generation time instead of needing the
// whole document re-created by hand.
function generatePartnerAgreementPdf({ partnerName, partnerId, partnerEmail, partnerPhone, partnerAddress, businessName, effectiveDate, responseDeadline }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const headerBuf = Buffer.from(HEADER_BASE64, 'base64');
    const footerBuf = Buffer.from(FOOTER_BASE64, 'base64');
    const HEADER_W = 468, HEADER_H = HEADER_W * (300 / 1491);
    const FOOTER_W = 468, FOOTER_H = FOOTER_W * (235 / 1491);
    const MARGIN_X = 72;
    const CONTENT_TOP = 20 + HEADER_H + 18;
    const CONTENT_BOTTOM = doc.page.height - (20 + FOOTER_H + 14);

    function drawHeaderFooter() {
      doc.image(headerBuf, (W - HEADER_W) / 2, 20, { width: HEADER_W, height: HEADER_H });
      doc.image(footerBuf, (W - FOOTER_W) / 2, doc.page.height - 20 - FOOTER_H, { width: FOOTER_W, height: FOOTER_H });
    }
    drawHeaderFooter();
    doc.on('pageAdded', drawHeaderFooter);

    doc.y = CONTENT_TOP;

    function bodyText(text, opts = {}) {
      doc.fillColor('#1a1a2e').fontSize(10.5).font('Helvetica')
        .text(text, MARGIN_X, doc.y, { width: W - MARGIN_X * 2, align: 'justify', ...opts });
      doc.moveDown(0.6);
    }
    function boldLine(text) {
      doc.fillColor('#1a1a2e').fontSize(10.5).font('Helvetica-Bold')
        .text(text, MARGIN_X, doc.y, { width: W - MARGIN_X * 2 });
      doc.moveDown(0.3);
    }

    // Ensure content never starts above where the header ends, on every
    // page — PDFKit doesn't reset doc.y automatically on auto-pagination.
    const originalAddPage = doc.addPage.bind(doc);
    doc.addPage = function (...args) {
      const result = originalAddPage(...args);
      doc.y = CONTENT_TOP;
      return result;
    };

    boldLine(`Date: ${effectiveDate}`);
    doc.moveDown(0.6);
    boldLine(partnerName);
    if (businessName) boldLine(businessName);
    if (partnerAddress) bodyText(partnerAddress);
    bodyText(`${partnerPhone || '—'} · ${partnerEmail}`);
    doc.moveDown(0.4);

    doc.fillColor(NAVY).fontSize(14).font('Helvetica-Bold')
      .text('CHANNEL PARTNER AGREEMENT', MARGIN_X, doc.y, { width: W - MARGIN_X * 2, align: 'center' });
    doc.moveDown(0.15);
    doc.fillColor(GRAY).fontSize(8.5).font('Helvetica-Oblique')
      .text('Auto-generated from the current agreement template', MARGIN_X, doc.y, { width: W - MARGIN_X * 2, align: 'center' });
    doc.moveDown(0.8);

    boldLine(`Dear ${partnerName},`);
    doc.moveDown(0.3);

    bodyText(`We are pleased to set out below the terms on which Dream2Fly Consulting Services Limited ("the Company") and ${businessName || partnerName} ("the Partner", Partner ID: ${partnerId}) will work together to refer prospective candidates ("Candidates") to the Company for study-abroad and related services. This Agreement is effective from ${effectiveDate} and remains in force until terminated as set out in Clause 6 below.`);

    for (const [title, text] of CLAUSES) {
      if (doc.y > CONTENT_BOTTOM - 60) doc.addPage();
      boldLine(title);
      for (const para of text.split('\n\n')) bodyText(para);
    }

    if (doc.y > CONTENT_BOTTOM - 100) doc.addPage();
    bodyText(`Please confirm your acceptance of this Agreement by signing and returning a copy on or before ${responseDeadline}.`);
    bodyText('We look forward to a successful partnership.');
    doc.moveDown(0.4);
    bodyText('Yours sincerely,');
    doc.moveDown(0.3);

    if (doc.y > CONTENT_BOTTOM - 130) doc.addPage();
    boldLine('For Dream2Fly Consulting Services Limited:');
    bodyText('Authorised Representative: Vijaymohan Sanduri');
    bodyText('Designation: Chief Executive Officer (CEO)');
    doc.moveDown(0.2);

    const sigBuf = Buffer.from(SIGNATURE_BASE64, 'base64');
    const stampBuf = Buffer.from(STAMP_BASE64, 'base64');
    const sigY = doc.y;
    doc.image(sigBuf, MARGIN_X, sigY, { width: 150, height: 150 * (258 / 942) });
    doc.image(stampBuf, W - MARGIN_X - 70, sigY - 10, { width: 70, height: 70 });
    doc.y = sigY + 150 * (123 / 450) + 10;

    if (doc.y > CONTENT_BOTTOM - 90) doc.addPage();
    doc.moveDown(0.4);
    boldLine('Acceptance:');
    bodyText(`I, ${partnerName}, on behalf of ${businessName || partnerName}, accept the above terms of this Channel Partner Agreement.`);
    doc.moveDown(1.2);
    doc.fillColor('#1a1a2e').fontSize(10.5).font('Helvetica')
      .text('Signature: _______________________________', MARGIN_X, doc.y, { continued: false })
      .text(`Date: _______________`, W - MARGIN_X - 150, doc.y - 12.5);

    doc.end();
  });
}

module.exports = { generatePartnerAgreementPdf };
