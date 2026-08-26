// Real, live numbers for the Admin Dashboard overview cards — this used
// to be hardcoded placeholder text on the frontend (always showing the
// same fake figures regardless of what's actually in the database).
// Uses count()/aggregate() rather than fetching full record lists, so
// this stays fast even as the dataset grows.

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/overview-stats', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    channelPartnersTotal,
    channelPartnersActive,
    leadsTotal,
    leadsThisWeek,
    activeApplications,
    activeApplicationServices,
    visasApproved,
    visasRefused,
    payableCommissions,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CHANNEL_PARTNER' } }),
    prisma.user.count({ where: { role: 'CHANNEL_PARTNER', active: true } }),
    prisma.lead.count(),
    prisma.lead.count({ where: { dateAdded: { gte: sevenDaysAgo } } }),
    prisma.application.count({ where: { NOT: { status: 'Rejected' } } }),
    prisma.application.findMany({ distinct: ['country'], select: { country: true }, where: { country: { not: null } } }),
    prisma.lead.count({ where: { status: 'VISA_APPROVED' } }),
    prisma.lead.count({ where: { status: 'VISA_REFUSED' } }),
    prisma.commission.findMany({ where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { amount: true, partnerId: true } }),
  ]);

  const commissionPayable = payableCommissions.reduce((sum, c) => sum + c.amount, 0);
  const commissionPayablePartners = new Set(payableCommissions.map(c => c.partnerId)).size;

  res.json({
    channelPartners: { total: channelPartnersActive, sub: `${channelPartnersTotal - channelPartnersActive} inactive` },
    leads: { total: leadsTotal, sub: `+${leadsThisWeek} this week` },
    activeApplications: { total: activeApplications, sub: `across ${activeApplicationServices.length} countries` },
    visasApproved: { total: visasApproved, sub: `${visasRefused} refused` },
    commissionPayable: { total: commissionPayable, sub: `${commissionPayablePartners} partner${commissionPayablePartners === 1 ? '' : 's'}` },
  });
});

module.exports = router;
