const PDFDocument = require('pdfkit');
const { HEADER_BASE64, FOOTER_BASE64, STAMP_BASE64 } = require('./partnerAgreementAssets');

const NAVY = '#0b1f4d';

// A typed-name signature has no separate uploaded file the way an
// "upload signed copy" does — so admin previously had nothing to view
// or download for it, just a line of status text. This generates an
// actual certificate confirming who signed what and when, using the
// same real branding as the agreement itself, so there's something
// concrete on file either way someone signs.
function generateSignatureCertificatePdf({ documentTitle, signerName, signerEmail, typedName, signedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const headerBuf = Buffer.from(HEADER_BASE64, 'base64');
    const footerBuf = Buffer.from(FOOTER_BASE64, 'base64');
    const stampBuf = Buffer.from(STAMP_BASE64, 'base64');
    const HEADER_W = 468, HEADER_H = HEADER_W * (300 / 1491);
    const FOOTER_W = 468, FOOTER_H = FOOTER_W * (235 / 1491);
    doc.image(headerBuf, (W - HEADER_W) / 2, 20, { width: HEADER_W, height: HEADER_H });
    doc.image(footerBuf, (W - FOOTER_W) / 2, doc.page.height - 20 - FOOTER_H, { width: FOOTER_W, height: FOOTER_H });

    let y = 20 + HEADER_H + 50;
    doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold')
      .text('CERTIFICATE OF ELECTRONIC SIGNATURE', 72, y, { width: W - 144, align: 'center' });
    y += 60;

    const rows = [
      ['Document', documentTitle],
      ['Signed by', signerName],
      ['Email on file', signerEmail],
      ['Typed signature', typedName],
      ['Date and time signed', new Date(signedAt).toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
    ];
    for (const [label, value] of rows) {
      doc.fillColor('#555').fontSize(10.5).font('Helvetica-Bold').text(label, 90, y, { width: 160 });
      doc.fillColor('#1a1a2e').fontSize(11).font('Helvetica').text(value, 260, y, { width: W - 260 - 72 });
      y += 32;
    }

    y += 20;
    doc.fillColor('#888').fontSize(9.5).font('Helvetica-Oblique')
      .text('This certificate confirms that the above party electronically signed the named document by typing their full name as an electronic signature, in place of a handwritten signature.', 90, y, { width: W - 90 - 72, align: 'left' });

    doc.image(stampBuf, W - 72 - 90, y + 60, { width: 90, height: 90 });

    doc.end();
  });
}

module.exports = { generateSignatureCertificatePdf };
