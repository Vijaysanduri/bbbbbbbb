const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, requireHrCapability } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { generatePayslipPdf } = require('../utils/payslipPdf');

const router = express.Router();
const prisma = new PrismaClient();

// Shared calculation: given a "YYYY-MM" month string and a user, work out
// their attendance-based pay for that month. Kept as one flat monthly
// salary pro-rated by payable days — no allowances/deductions/tax slabs,
// which would be a much bigger payroll-specific feature than what's built
// here. Payable days = present + approved leave + holidays (all paid);
// half-days count as 0.5; anything else in the month is unpaid absence.
async function calculateForUser(user, month) {
  const [year, mon] = month.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
  const daysInMonth = monthEnd.getUTCDate();

  const attendanceRows = await prisma.attendance.findMany({
    where: { userId: user.id, date: { gte: monthStart, lte: monthEnd } },
  });
  const daysPresent = attendanceRows.filter(a => a.status === 'PRESENT' || a.status === 'WORK_FROM_HOME').length;
  const halfDays = attendanceRows.filter(a => a.status === 'HALF_DAY').length;

  const leaveRows = await prisma.leaveRequest.findMany({
    where: { userId: user.id, status: 'APPROVED', fromDate: { lte: monthEnd }, toDate: { gte: monthStart } },
  });
  let daysOnLeave = 0;
  for (const l of leaveRows) {
    const from = l.fromDate < monthStart ? monthStart : l.fromDate;
    const to = l.toDate > monthEnd ? monthEnd : l.toDate;
    daysOnLeave += Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1);
  }

  const holidayRows = await prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } } });
  const daysHoliday = holidayRows.length;

  const payableDays = daysPresent + (halfDays * 0.5) + daysOnLeave + daysHoliday;
  const daysAbsent = Math.max(0, daysInMonth - daysPresent - halfDays - daysOnLeave - daysHoliday);

  const baseSalary = user.baseSalary || 0;
  const grossPay = baseSalary;
  const netPay = daysInMonth > 0 ? Math.round((baseSalary * (payableDays / daysInMonth)) * 100) / 100 : 0;

  return { daysInMonth, daysPresent, daysAbsent, daysOnLeave, daysHoliday, baseSalary, grossPay, netPay };
}

// GET /api/payroll/:month/preview — Admin/HR/Super Admin only.
// Shows the calculation for every active employee WITHOUT saving
// anything — this is the "check attendance before closing payroll" step.
router.get('/:month/preview', requireAuth, requireHrCapability('hrSeesPayroll', (req, res) => res.status(403).json({ error: 'You do not have permission to do this.' })), async (req, res) => {
  const { month } = req.params;
  const employees = await prisma.user.findMany({
    where: { active: true, role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'] } },
    orderBy: { fullName: 'asc' },
  });
  const period = await prisma.payrollPeriod.findUnique({ where: { month } });
  const rows = await Promise.all(employees.map(async (u) => ({
    userId: u.id,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    ...(await calculateForUser(u, month)),
  })));
  res.json({ status: period ? period.status : 'OPEN', rows });
});

// POST /api/payroll/:month/finalize — Admin/HR/Super Admin only.
// Locks in the calculation, creates each employee's Payslip with a real
// branded PDF, and emails it to them. A month can only be finalized once —
// re-running a finalized month is refused; corrections happen in the
// following month via the dispute flow, not by editing the past one.
router.post('/:month/finalize', requireAuth, requireHrCapability('hrSeesPayroll', (req, res) => res.status(403).json({ error: 'You do not have permission to do this.' })), async (req, res) => {
  const { month } = req.params;
  const existing = await prisma.payrollPeriod.findUnique({ where: { month } });
  if (existing && existing.status === 'FINALIZED') {
    return res.status(400).json({ error: `Payroll for ${month} is already finalized.` });
  }

  const period = await prisma.payrollPeriod.upsert({
    where: { month },
    update: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: req.user.id },
    create: { month, status: 'FINALIZED', finalizedAt: new Date(), finalizedById: req.user.id },
  });

  const employees = await prisma.user.findMany({
    where: { active: true, role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER'] } },
  });

  const results = [];
  for (const u of employees) {
    const calc = await calculateForUser(u, month);
    const pdfBuffer = await generatePayslipPdf({ employeeName: u.fullName, jobTitle: u.jobTitle, month, ...calc });
    const fileData = 'data:application/pdf;base64,' + pdfBuffer.toString('base64');

    const payslip = await prisma.payslip.create({
      data: {
        userId: u.id, month, fileName: `Payslip-${month}.pdf`, mimeType: 'application/pdf', fileData,
        uploadedById: req.user.id, isAutoCalculated: true, payrollPeriodId: period.id,
        daysInMonth: calc.daysInMonth, daysPresent: calc.daysPresent, daysAbsent: calc.daysAbsent,
        daysOnLeave: calc.daysOnLeave, daysHoliday: calc.daysHoliday, grossPay: calc.grossPay, netPay: calc.netPay,
      },
    });

    await sendMail({
      to: u.email,
      subject: `Your payslip for ${month} is ready`,
      body: `Hi ${u.fullName},\n\nYour payslip for ${month} has been generated based on your recorded attendance and is now available in your Dream2Fly employee portal under Payslips.\n\nNet pay: Rs. ${calc.netPay.toFixed(2)}\n\nIf anything looks incorrect, please raise a query from your Payslips tab — it will be reviewed and corrected in next month's payroll.\n\nBest,\nDream2Fly HR`,
      attachmentFileName: `Payslip-${month}.pdf`,
      attachmentBase64: fileData,
      attachmentMimeType: 'application/pdf',
    });

    results.push({ userId: u.id, fullName: u.fullName, netPay: calc.netPay, payslipId: payslip.id });
  }

  res.json({ month, status: 'FINALIZED', count: results.length, results });
});

// GET /api/payroll/months — list all payroll periods that exist so far.
router.get('/months', requireAuth, requireHrCapability('hrSeesPayroll', (req, res) => res.status(403).json({ error: 'You do not have permission to do this.' })), async (req, res) => {
  const periods = await prisma.payrollPeriod.findMany({ orderBy: { month: 'desc' } });
  res.json(periods);
});

module.exports = router;
