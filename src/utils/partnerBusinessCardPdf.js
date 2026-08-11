const PDFDocument = require('pdfkit');
const { LOGO_BASE64 } = require('./logoBase64');

const NAVY = '#132a5e';
const RED = '#e8241a';
const WHITE = '#ffffff';

const CARD_W = 3.5 * 72; // standard business card, 3.5" x 2"
const CARD_H = 2 * 72;

// Generates a two-page (front/back) business card PDF for a Channel
// Partner, styled after the person's own existing card: navy panel with
// a curved red ribbon accent, red circular contact-icon badges (drawn
// as real phone/envelope/globe/home shapes, not letter abbreviations),
// and the logo on a white side panel; back has a services grid and a
// curved bottom band. Auto-filled from the partner's real account data.
function generatePartnerBusinessCardPdf({ partnerName, partnerEmail, partnerPhone, partnerAddress }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [CARD_W, CARD_H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const logoBuffer = Buffer.from(LOGO_BASE64, 'base64');

    // ===== FRONT =====
    const splitX = CARD_W * 0.66;
    doc.rect(0, 0, CARD_W, CARD_H).fill(NAVY);
    doc.rect(splitX, 0, CARD_W - splitX, CARD_H).fill(WHITE);

    // Single clean red ribbon — narrow enough to stay a visual accent
    // rather than dominate the panel and wash out the logo behind it.
    doc.moveTo(splitX + 15, 0)
      .bezierCurveTo(splitX - 15, CARD_H * 0.38, splitX + 35, CARD_H * 0.62, splitX + 5, CARD_H)
      .lineTo(splitX + 28, CARD_H)
      .bezierCurveTo(splitX + 58, CARD_H * 0.62, splitX + 15, CARD_H * 0.38, splitX + 45, 0)
      .closePath().fill(RED);

    // Partner name — wraps around the natural word midpoint
    const words = partnerName.split(' ');
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11.5);
    let ny = 12;
    doc.text(line1.toUpperCase(), 18, ny);
    ny += 13;
    if (line2) { doc.text(line2.toUpperCase(), 18, ny); ny += 13; }

    doc.font('Helvetica').fontSize(9).text('Channel Partner', 18, ny + 6);
    doc.moveTo(18, ny + 21).lineTo(82, ny + 21).lineWidth(1.5).strokeColor(RED).stroke();

    // Real drawn icons (phone/envelope/globe/home) instead of letter
    // abbreviations — small vector shapes, not a font dependency.
    function iconBadge(cx, cy, drawFn) {
      doc.circle(cx, cy, 8.5).fill(RED);
      drawFn(cx, cy);
    }
    function drawPhone(cx, cy) {
      doc.save();
      doc.translate(cx, cy);
      doc.path('M -3.2,-3.5 C -4.5,-1.5 -4.5,1.5 -3.2,3.2 C -2.5,4 -1.5,3.8 -1.2,2.8 C -1,2 -1.4,1.6 -1.9,1.1 C -1.3,-0.2 -0.2,-1.3 1.1,-1.9 C 1.6,-1.4 2,-1 2.8,-1.2 C 3.8,-1.5 4,-2.5 3.2,-3.2 C 1.5,-4.5 -1.5,-4.5 -3.2,-3.5 Z').fill(WHITE);
      doc.restore();
    }
    function drawEnvelope(cx, cy) {
      doc.rect(cx - 4, cy - 2.8, 8, 5.6).lineWidth(1).strokeColor(WHITE).stroke();
      doc.moveTo(cx - 4, cy - 2.8).lineTo(cx, cy + 0.3).lineTo(cx + 4, cy - 2.8).strokeColor(WHITE).stroke();
    }
    function drawGlobe(cx, cy) {
      doc.circle(cx, cy, 4).lineWidth(0.9).strokeColor(WHITE).stroke();
      doc.ellipse(cx, cy, 1.7, 4).lineWidth(0.9).strokeColor(WHITE).stroke();
      doc.moveTo(cx - 4, cy).lineTo(cx + 4, cy).strokeColor(WHITE).stroke();
    }
    function drawHome(cx, cy) {
      doc.moveTo(cx - 4.5, cy + 0.5).lineTo(cx, cy - 4).lineTo(cx + 4.5, cy + 0.5)
        .lineTo(cx + 3, cy + 0.5).lineTo(cx + 3, cy + 4).lineTo(cx - 3, cy + 4)
        .lineTo(cx - 3, cy + 0.5).closePath().fill(WHITE);
    }
    function contactRow(y, drawFn, text) {
      iconBadge(27, y, drawFn);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8).text(text, 44, y - 4);
    }

    let rowY = ny + 21 + 15;
    contactRow(rowY, drawPhone, partnerPhone || 'Phone on file');
    rowY += 17;
    contactRow(rowY, drawEnvelope, partnerEmail || 'Email on file');
    rowY += 17;
    contactRow(rowY, drawGlobe, 'www.dream2fly.co.uk');
    rowY += 17;
    contactRow(rowY, drawHome, partnerAddress || 'Dream2Fly Consulting Services Ltd.');

    // Logo + wordmark on the white panel
    const logoSize = 58;
    const panelCx = splitX + (CARD_W - splitX) / 2;
    doc.image(logoBuffer, panelCx - logoSize / 2, 16, { width: logoSize, height: logoSize });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5).text('DREAM2FLY', splitX, 16 + logoSize + 4, { width: CARD_W - splitX, align: 'center' });
    doc.font('Helvetica').fontSize(5.5).text('CONSULTING SERVICES', splitX, 16 + logoSize + 18, { width: CARD_W - splitX, align: 'center' });

    doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });

    // ===== BACK =====
    doc.rect(0, 0, CARD_W, CARD_H).fill(WHITE);

    const logoSize2 = 40;
    doc.image(logoBuffer, CARD_W / 2 - 70, 12, { width: logoSize2, height: logoSize2 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text('DREAM2FLY', CARD_W / 2 - 24, 20);
    doc.font('Helvetica').fontSize(6).text('CONSULTING SERVICES', CARD_W / 2 - 24, 34);

    function checkItem(x, y, text) {
      doc.circle(x, y, 6).lineWidth(1.1).strokeColor(NAVY).stroke();
      doc.moveTo(x - 3, y - 0.5).lineTo(x - 1, y + 3).lineWidth(1.3).strokeColor(NAVY).stroke();
      doc.moveTo(x - 1, y + 3).lineTo(x + 3.5, y - 3.5).lineWidth(1.3).strokeColor(NAVY).stroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text(text, x + 12, y - 4);
    }
    checkItem(28, 62, 'Student Visa');
    checkItem(190, 62, 'Work Visa');
    checkItem(28, 82, 'Visiting Visa');
    checkItem(184, 82, 'Spouse Visa');

    doc.moveTo(0, CARD_H - 26)
      .bezierCurveTo(CARD_W * 0.3, CARD_H - 44, CARD_W * 0.7, CARD_H - 6, CARD_W, CARD_H - 26)
      .lineTo(CARD_W, CARD_H).lineTo(0, CARD_H).closePath().fill(RED);
    doc.moveTo(0, CARD_H - 20)
      .bezierCurveTo(CARD_W * 0.3, CARD_H - 36, CARD_W * 0.7, CARD_H - 2, CARD_W, CARD_H - 18)
      .lineTo(CARD_W, CARD_H).lineTo(0, CARD_H).closePath().fill(NAVY);

    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8).text('info@dream2fly.co.uk', 0, CARD_H - 14, { width: CARD_W, align: 'center' });

    doc.end();
  });
}

module.exports = { generatePartnerBusinessCardPdf };
