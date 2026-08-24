const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');
const { createNotification } = require('../utils/notifications');

const router = express.Router();
const prisma = new PrismaClient();

const VALID_CATEGORIES = ['EMPLOYEE', 'CHANNEL_PARTNER', 'COLLABORATION'];

// POST /api/career-applications/public — no auth required, called from the
// website's Careers/Partner/Collaboration form. Deliberately minimal
// validation (name, email, category) so this stays a low-friction "reach
// out to us" form, not a job application with attachments — if someone's
// promising, a real conversation happens after Admin reviews this.
router.post('/public', async (req, res) => {
  const { category, fullName, phone, message } = req.body;
  const email = (req.body.email || '').trim().toLowerCase();
  if (!fullName || !email || !category || !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Full name, email, and a valid category are required.' });
  }
  const application = await prisma.careerApplication.create({
    data: { category, fullName, email, phone: phone || null, message: message || null },
  });
  await logActivity(`${fullName} submitted a ${category.replace('_', ' ').toLowerCase()} application via the website.`, null);

  // Alert every active Admin/Super Admin — same "leadership sees it
  // immediately" pattern already used for new leads, via both the bell
  // and email, since this needs a human decision (approve/reject), not
  // just a record sitting in a list nobody happens to check.
  const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, active: true } });
  const categoryLabel = category === 'EMPLOYEE' ? 'Employee' : category === 'CHANNEL_PARTNER' ? 'Channel Partner' : 'Collaboration';
  for (const admin of admins) {
    createNotification(admin.id, `New ${categoryLabel} application`, `${fullName} applied — review it in Career Applications.`, 'GENERAL', 'career-applications')
      .catch(err => console.error('[career-applications/public] createNotification failed:', err.message));
    sendMail({
      to: admin.email,
      subject: `New ${categoryLabel} application — ${fullName}`,
      body: `${fullName} (${email}${phone ? ', ' + phone : ''}) just submitted a ${categoryLabel} application via the website.\n\n${message ? 'Message:\n' + message + '\n\n' : ''}Review it in Admin → Career Applications.`,
    }).catch(err => console.error('[career-applications/public] Email failed:', err.message));
  }

  res.status(201).json({ success: true, message: 'Thank you — we\'ll be in touch soon.' });
});

// GET /api/career-applications — Admin/Super Admin only.
router.get('/', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const applications = await prisma.careerApplication.findMany({
    include: { reviewedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(applications);
});

// PATCH /api/career-applications/:id/approve — Admin/Super Admin only.
// Body: { password? } — Collaboration applications don't get an account
// (they're a business conversation, not a portal user), so this only
// creates one for EMPLOYEE/CHANNEL_PARTNER categories. If an account with
// that email already exists, this just marks the application Approved
// without creating a duplicate — someone may have already been added
// directly through the normal Add Employee flow in the meantime.
router.patch('/:id/approve', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const application = await prisma.careerApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (application.status !== 'PENDING') return res.status(400).json({ error: 'This application has already been reviewed.' });

  let createdAccount = false;
  let plainPassword = null;
  if (application.category !== 'COLLABORATION') {
    const existing = await prisma.user.findUnique({ where: { email: application.email } });
    if (!existing) {
      plainPassword = req.body.password && req.body.password.length >= 8 ? req.body.password : Math.random().toString(36).slice(-10) + 'A1!';
      const passwordHash = await bcrypt.hash(plainPassword, 10);
      const role = application.category === 'CHANNEL_PARTNER' ? 'CHANNEL_PARTNER' : 'EMPLOYEE';
      await prisma.user.create({
        data: { fullName: application.fullName, email: application.email, phone: application.phone, passwordHash, role },
      });
      createdAccount = true;
      sendMail({
        to: application.email,
        subject: `Your Dream2Fly account is ready`,
        body: `Hi ${application.fullName},\n\nGreat news — your application has been approved. Here's how to sign in:\n\nPortal: https://dream2fly.co.uk/login.html\nEmail: ${application.email}\nPassword: ${plainPassword}\n\nPlease sign in and change your password as soon as you can.\n\nBest,\nDream2Fly`,
      }).catch(err => console.error('[career-applications/approve] Welcome email failed:', err.message));
    }
  }

  const updated = await prisma.careerApplication.update({
    where: { id: req.params.id },
    data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
  });
  await logActivity(`${req.user.fullName} approved ${application.fullName}'s ${application.category.replace('_', ' ').toLowerCase()} application.`, req.user.id);
  res.json({ ...updated, createdAccount });
});

// PATCH /api/career-applications/:id/reject — Admin/Super Admin only.
router.patch('/:id/reject', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const application = await prisma.careerApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (application.status !== 'PENDING') return res.status(400).json({ error: 'This application has already been reviewed.' });
  const updated = await prisma.careerApplication.update({
    where: { id: req.params.id },
    data: { status: 'REJECTED', reviewedById: req.user.id, reviewedAt: new Date() },
  });
  await logActivity(`${req.user.fullName} declined ${application.fullName}'s ${application.category.replace('_', ' ').toLowerCase()} application.`, req.user.id);
  res.json(updated);
});

module.exports = router;
