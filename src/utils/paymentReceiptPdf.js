const PDFDocument = require('pdfkit');

const NAVY = '#0b1f4d';
const GOLD = '#f6c221';
const RED = '#a11d24';

// Generates a branded payment receipt PDF as a Buffer, in the same style
// as the payslip generator (utils/payslipPdf.js) — header bar with the
// company name standing in for the logo image, since no logo file is
// bundled into the backend. Called once, at the moment a payment
// verifies successfully, and the resulting PDF is stored on the Payment
// row (receiptPdf) so it can be viewed/downloaded later without
// regenerating it — the receipt should never change after issue, even if
// something about the student's other details changes afterward.
function generatePaymentReceiptPdf({ receiptNumber, studentName, studentEmail, purpose, amount, paidAt, paymentId, requestedByName, remarks }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('DREAM2FLY', 50, 28);
    doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold').text('CONSULTING SERVICES LTD.', 50, 52);
    doc.fillColor('#cfd8ee').fontSize(9).font('Helvetica').text('Your Dreams. Our Guidance. Your Global Future.', 50, 66);

    doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold').text('Payment Receipt', 50, 120);
    doc.fillColor('#666').fontSize(10).font('Helvetica').text(`Receipt No. ${receiptNumber}`, 50, 145);
    doc.moveTo(50, 165).lineTo(545, 165).strokeColor(GOLD).lineWidth(2).stroke();

    let y = 190;
    const row = (label, value, opts = {}) => {
      doc.fillColor('#555').fontSize(10).font('Helvetica').text(label, 60, y);
      doc.fillColor('#111').fontSize(10).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').text(value, 250, y, { width: 295 });
      y += 22;
    };

    row('Received From', studentName);
    row('Email', studentEmail);
    row('Purpose', purpose);
    row('Payment Date', new Date(paidAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    row('Payment Reference (Razorpay)', paymentId || '—');
    row('Processed By', requestedByName || 'Dream2Fly');

    y += 15;
    doc.rect(50, y, 495, 44).fill('#faf6e8');
    doc.fillColor(RED).fontSize(14).font('Helvetica-Bold').text('Amount Paid', 65, y + 14);
    doc.fillColor(RED).fontSize(14).font('Helvetica-Bold').text(`Rs. ${Number(amount).toFixed(2)}`, 400, y + 14);
    y += 70;

    if (remarks) {
      doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text('Remarks', 50, y);
      y += 18;
      doc.fillColor('#333').fontSize(9).font('Helvetica').text(remarks, 50, y, { width: 495 });
      y += 40;
    }

    doc.fillColor('#999').fontSize(8).font('Helvetica').text(
      'This is a system-generated receipt confirming a successful payment made via Razorpay. For any query regarding this transaction, please contact your Dream2Fly counsellor with the receipt number above.',
      50, 720, { width: 495 }
    );

    doc.end();
  });
}

module.exports = { generatePaymentReceiptPdf };
