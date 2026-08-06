const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/summary?month=YYYY-MM — Admin/Super Admin only.
// One combined snapshot instead of the frontend making a dozen separate
// calls to piece this together itself.
router.get('/summary', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const monthStart = new Date(month + '-01T00:00:00.000Z');
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const [
    leadsThisMonth, convertedThisMonth, leadsBySourceRaw, leadsByStatusRaw,
    tasksTotal, tasksByPriorityRaw, tasksByStatusRaw,
    attendanceThisMonth, payslipsThisMonth,
    employeeExpensesThisMonth, companyExpensesThisMonth,
    resignationsThisMonth, activeEmployeeCount,
  ] = await Promise.all([
    prisma.lead.count({ where: { dateAdded: { gte: monthStart, lt: monthEnd } } }),
    prisma.lead.count({ where: { dateAdded: { gte: monthStart, lt: monthEnd }, status: 'CONVERTED' } }),
    prisma.lead.groupBy({ by: ['source'], where: { dateAdded: { gte: monthStart, lt: monthEnd } }, _count: true }),
    prisma.lead.groupBy({ by: ['status'], where: { dateAdded: { gte: monthStart, lt: monthEnd } }, _count: true }),
    prisma.task.count({ where: { due: { gte: monthStart, lt: monthEnd } } }),
    prisma.task.groupBy({ by: ['priority'], where: { due: { gte: monthStart, lt: monthEnd } }, _count: true }),
    prisma.task.groupBy({ by: ['status'], where: { due: { gte: monthStart, lt: monthEnd } }, _count: true }),
    prisma.attendance.findMany({ where: { date: { gte: monthStart, lt: monthEnd } } }),
    prisma.payslip.findMany({ where: { month } }),
    prisma.expense.findMany({ where: { expenseType: 'EMPLOYEE_CLAIM', status: 'APPROVED', createdAt: { gte: monthStart, lt: monthEnd } } }),
    prisma.expense.findMany({ where: { expenseType: 'COMPANY_EXPENSE', createdAt: { gte: monthStart, lt: monthEnd } } }),
    prisma.resignation.count({ where: { requestedAt: { gte: monthStart, lt: monthEnd } } }),
    prisma.user.count({ where: { active: true, role: { in: ['EMPLOYEE', 'COUNSELLOR', 'MANAGER', 'HR'] } } }),
  ]);

  const leadsBySource = {};
  leadsBySourceRaw.forEach(r => { leadsBySource[r.source] = r._count; });
  const leadsByStatus = {};
  leadsByStatusRaw.forEach(r => { leadsByStatus[r.status] = r._count; });
  const tasksByPriority = {};
  tasksByPriorityRaw.forEach(r => { tasksByPriority[r.priority] = r._count; });
  const tasksByStatus = {};
  tasksByStatusRaw.forEach(r => { tasksByStatus[r.status] = r._count; });

  const presentCount = attendanceThisMonth.filter(a => a.status === 'PRESENT' || a.status === 'WORK_FROM_HOME' || a.status === 'HALF_DAY').length;
  const attendanceRate = attendanceThisMonth.length ? Math.round((presentCount / attendanceThisMonth.length) * 100) : null;

  const totalPayrollCost = payslipsThisMonth.reduce((sum, p) => sum + (p.netPay || 0), 0);
  const totalEmployeeExpenseClaims = employeeExpensesThisMonth.reduce((sum, e) => sum + e.amount, 0);
  const totalCompanyExpenses = companyExpensesThisMonth.reduce((sum, e) => sum + e.amount, 0);

  res.json({
    month,
    leads: { total: leadsThisMonth, converted: convertedThisMonth, conversionRate: leadsThisMonth ? Math.round((convertedThisMonth / leadsThisMonth) * 100) : 0, bySource: leadsBySource, byStatus: leadsByStatus },
    tasks: { total: tasksTotal, byPriority: tasksByPriority, byStatus: tasksByStatus },
    attendance: { rate: attendanceRate, recordCount: attendanceThisMonth.length },
    payroll: { totalCost: totalPayrollCost, payslipCount: payslipsThisMonth.length },
    expenses: { employeeClaims: totalEmployeeExpenseClaims, companyExpenses: totalCompanyExpenses },
    resignations: { count: resignationsThisMonth },
    headcount: activeEmployeeCount,
  });
});

// GET /api/reports/partners — Admin/Super Admin only. Every Channel
// Partner, with their referral count, conversion rate, and commission
// earned — a directory view, not partner-specific finance management
// (that stays under Partner Finance).
router.get('/partners', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const partners = await prisma.user.findMany({ where: { role: 'CHANNEL_PARTNER' }, orderBy: { fullName: 'asc' } });

  const directory = await Promise.all(partners.map(async (partner) => {
    const [referredCount, convertedCount, commissions] = await Promise.all([
      prisma.lead.count({ where: { referredByPartnerId: partner.id } }),
      prisma.lead.count({ where: { referredByPartnerId: partner.id, status: 'CONVERTED' } }),
      prisma.commission.findMany({ where: { partnerId: partner.id } }),
    ]);
    const commissionEarned = commissions.filter(c => c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
    const commissionPending = commissions.filter(c => c.status !== 'PAID').reduce((sum, c) => sum + c.amount, 0);
    return {
      id: partner.id, fullName: partner.fullName, email: partner.email, active: partner.active,
      referredCount, convertedCount,
      conversionRate: referredCount ? Math.round((convertedCount / referredCount) * 100) : 0,
      commissionEarned, commissionPending,
    };
  }));

  res.json(directory);
});

module.exports = router;
