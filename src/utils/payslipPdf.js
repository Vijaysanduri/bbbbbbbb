const PDFDocument = require('pdfkit');

const NAVY = '#0b1f4d';
const GOLD = '#f6c221';
const RED = '#a11d24';

// Generates a branded payslip PDF as a Buffer. Kept deliberately simple —
// header/footer branding, a breakdown table, no logo image embedded (would
// need the actual logo file bundled into the backend, which isn't set up
// here) — the navy/gold color bar and company name stand in for that.
function generatePayslipPdf({ employeeName, jobTitle, month, daysInMonth, daysPresent, daysAbsent, daysOnLeave, daysHoliday, baseSalary, grossPay, netPay }) {
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

    doc.moveDown(4);
    doc.fillColor(NAVY).fontSize(16).font('Helvetica-Bold').text(`Payslip — ${month}`, 50, 120);
    doc.moveTo(50, 145).lineTo(545, 145).strokeColor(GOLD).lineWidth(2).stroke();

    doc.fillColor('#333').fontSize(11).font('Helvetica');
    doc.text(`Employee: ${employeeName}`, 50, 165);
    doc.text(`Role: ${jobTitle || '—'}`, 50, 183);

    // Attendance breakdown table
    let y = 220;
    doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text('Attendance Summary', 50, y);
    y += 25;
    const rows = [
      ['Days in month', daysInMonth],
      ['Days present', daysPresent],
      ['Days on approved leave', daysOnLeave],
      ['Holidays', daysHoliday],
      ['Days absent', daysAbsent],
    ];
    doc.fontSize(10).font('Helvetica');
    rows.forEach(([label, value]) => {
      doc.fillColor('#555').text(label, 60, y);
      doc.fillColor('#111').text(String(value), 400, y);
      y += 20;
    });

    y += 15;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#ddd').lineWidth(1).stroke();
    y += 20;

    doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text('Pay Summary', 50, y);
    y += 25;
    doc.fontSize(10).font('Helvetica');
    doc.fillColor('#555').text('Base monthly salary', 60, y);
    doc.fillColor('#111').text(`Rs. ${baseSalary.toFixed(2)}`, 400, y);
    y += 20;
    doc.fillColor('#555').text('Gross pay (attendance-adjusted)', 60, y);
    doc.fillColor('#111').text(`Rs. ${grossPay.toFixed(2)}`, 400, y);
    y += 30;

    doc.rect(50, y, 495, 36).fill('#faf6e8');
    doc.fillColor(RED).fontSize(13).font('Helvetica-Bold').text('Net Pay', 65, y + 10);
    doc.fillColor(RED).fontSize(13).font('Helvetica-Bold').text(`Rs. ${netPay.toFixed(2)}`, 400, y + 10);

    doc.fillColor('#999').fontSize(8).font('Helvetica').text(
      'This payslip was generated automatically from recorded attendance. If any figure looks incorrect, raise a query from your Payslips tab — it will be reviewed and corrected in the following month\'s payroll run.',
      50, y + 60, { width: 495 }
    );

    doc.end();
  });
}

module.exports = { generatePayslipPdf };
