const PDFDocument = require('pdfkit');
const { LOGO_BASE64 } = require('./logoBase64');

const NAVY = '#0b1f4d';
const NAVY_LIGHT = '#3a5da8';
const GOLD = '#f6c221';
const GOLD_DARK = '#b8860b';
const RED = '#a11d24';
const CREAM = '#fffefb';

// Generates the official "Channel Partner Certificate" — landscape,
// styled after a reference design the person shared: full-height navy
// side bands, a gold bottom band, elegant corner brackets, a circular
// logo badge, and a starburst rosette seal with ribbon tails. The logo
// is embedded as base64 (see logoBase64.js) since this backend has no
// access to the frontend's file system.
function generatePartnerCertificatePdf({ partnerName, partnerId, issueDate }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const logoBuffer = Buffer.from(LOGO_BASE64, 'base64');

    doc.rect(0, 0, W, H).fill(CREAM);

    // Left/right navy gradient bands
    const leftGrad = doc.linearGradient(0, 0, 26, 0);
    leftGrad.stop(0, NAVY).stop(1, NAVY_LIGHT);
    doc.rect(0, 0, 26, H).fill(leftGrad);
    const rightGrad = doc.linearGradient(W - 26, 0, W, 0);
    rightGrad.stop(0, NAVY_LIGHT).stop(1, NAVY);
    doc.rect(W - 26, 0, 26, H).fill(rightGrad);

    // Bottom gold band
    doc.rect(0, H - 22, W, 22).fill(GOLD);
    doc.rect(0, H - 22, W, 4).fill(GOLD_DARK);

    // Inner border, rounded
    const mx = 50, my = 42;
    doc.roundedRect(mx, my, W - 2 * mx, H - 2 * my, 4).lineWidth(1.2).strokeColor(GOLD_DARK).stroke();

    // Corner brackets — elegant L-shapes just inside each corner
    function bracket(x, y, dx, dy, size) {
      doc.moveTo(x, y).lineTo(x + dx * size, y).lineWidth(2.5).strokeColor(GOLD).stroke();
      doc.moveTo(x, y).lineTo(x, y + dy * size).lineWidth(2.5).strokeColor(GOLD).stroke();
    }
    bracket(mx + 14, my + 14, 1, 1, 34);
    bracket(W - mx - 14, my + 14, -1, 1, 34);
    bracket(mx + 14, H - my - 14, 1, -1, 34);
    bracket(W - mx - 14, H - my - 14, -1, -1, 34);

    // Logo — placed directly, no circular badge frame around it (removed
    // per feedback), sized generously so it reads clearly at a glance
    // rather than sitting inside a small contained shape.
    const badgeCx = 128, badgeCy = 100;
    const logoSize = 100;
    doc.image(logoBuffer, badgeCx - logoSize / 2, badgeCy - logoSize / 2, { width: logoSize, height: logoSize });

    // Title block
    doc.fillColor(NAVY).fontSize(40).font('Helvetica-Bold').text('CERTIFICATE', 0, 68, { align: 'center', width: W });
    doc.fillColor(GOLD_DARK).fontSize(15).font('Helvetica-Bold').text('O F   P A R T N E R S H I P', 0, 118, { align: 'center', width: W });

    doc.fillColor('#555').fontSize(12.5).font('Helvetica-Oblique').text('This certificate is proudly presented to', 0, 150, { align: 'center', width: W });

    // Partner name
    doc.fillColor(NAVY).fontSize(30).font('Helvetica-Bold').text(partnerName, 0, 172, { align: 'center', width: W });
    doc.moveTo(W / 2 - 190, 212).lineTo(W / 2 + 190, 212).lineWidth(1.2).strokeColor(GOLD_DARK).stroke();

    // Body text
    doc.fillColor('#5a4a20').fontSize(12.5).font('Helvetica')
      .text(`This is to certify that ${partnerName} is a recognized and officially authorized`, 0, 232, { align: 'center', width: W })
      .text('Channel Partner of Dream2Fly Consulting Services Ltd., entrusted to refer and represent', 0, 250, { align: 'center', width: W })
      .text('prospective students for study and work-abroad opportunities in good standing.', 0, 268, { align: 'center', width: W });

    // Gold starburst rosette seal, bottom center
    const sealX = W / 2, sealY = H - 130;
    const nPoints = 20, outerR = 42, innerR = 34;
    doc.save();
    for (let i = 0; i < nPoints * 2; i++) {
      const ang = (Math.PI * i) / nPoints;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = sealX + r * Math.sin(ang);
      const y = sealY - r * Math.cos(ang);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    }
    doc.closePath().fill(GOLD);
    doc.restore();
    doc.circle(sealX, sealY, 27).fill(GOLD_DARK);
    doc.circle(sealX, sealY, 23).fill(GOLD);
    doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('OFFICIAL', sealX - 30, sealY - 10, { width: 60, align: 'center' });
    doc.text('PARTNER', sealX - 30, sealY + 2, { width: 60, align: 'center' });
    // Ribbon tails
    doc.moveTo(sealX - 16, sealY + 38).lineTo(sealX - 28, sealY + 72).lineTo(sealX - 4, sealY + 58).closePath().fill(RED);
    doc.moveTo(sealX + 16, sealY + 38).lineTo(sealX + 28, sealY + 72).lineTo(sealX + 4, sealY + 58).closePath().fill(RED);

    // Signature — single (not fabricating a second person's name)
    const sigX = 190, sigY = H - 116;
    doc.moveTo(sigX - 90, sigY).lineTo(sigX + 90, sigY).lineWidth(0.75).strokeColor('#999').stroke();
    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text('Vijay Mohan Sanduri', sigX - 90, sigY + 5, { width: 180, align: 'center' });
    doc.fillColor('#777').fontSize(9).font('Helvetica').text('Founder & CEO, Dream2Fly', sigX - 90, sigY + 20, { width: 180, align: 'center' });

    // Partner ID + date, right side
    const detailX = W - 190;
    doc.fillColor('#777').fontSize(9).font('Helvetica')
      .text(`Partner ID: ${partnerId}`, detailX - 90, sigY + 5, { width: 180, align: 'center' })
      .text(`Issued: ${issueDate}`, detailX - 90, sigY + 20, { width: 180, align: 'center' });

    doc.end();
  });
}

module.exports = { generatePartnerCertificatePdf };
