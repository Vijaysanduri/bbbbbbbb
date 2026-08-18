const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole, requirePermission, requireHrCapability } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { rateLimiter } = require('../middleware/rateLimiter');
const { generatePartnerCertificatePdf } = require('../utils/partnerCertificatePdf');
const { generatePartnerBusinessCardPdf } = require('../utils/partnerBusinessCardPdf');

const router = express.Router();
const prisma = new PrismaClient();

const loginRateLimit = rateLimiter({ maxAttempts: 10, windowMs: 15 * 60 * 1000, message: 'Too many login attempts. Please wait a few minutes and try again.' });
const passwordChangeRateLimit = rateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000, message: 'Too many password change attempts. Please wait a few minutes and try again.' });

// POST /api/auth/login
// Body: { email, password }
router.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  res.json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, jobTitle: user.jobTitle, phone: user.phone }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    id: user.id, fullName: user.fullName, email: user.email, role: user.role, jobTitle: user.jobTitle, phone: user.phone,
    profilePhotoData: user.profilePhotoData, profilePhotoMimeType: user.profilePhotoMimeType,
    dateOfBirth: user.dateOfBirth, dateOfJoining: user.dateOfJoining,
    emergencyContactName: user.emergencyContactName, emergencyContactPhone: user.emergencyContactPhone, emergencyContactRelation: user.emergencyContactRelation,
    currentAddress: user.currentAddress, permanentAddress: user.permanentAddress, bloodGroup: user.bloodGroup,
    fatherName: user.fatherName, motherName: user.motherName, personalEmail: user.personalEmail,
    residenceAddress: user.residenceAddress, customOnboardingValues: user.customOnboardingValues,
  });
});

// PATCH /api/auth/me/photo — upload your own real profile photo. No
// stock/placeholder substitution — this is only ever whatever the
// person themselves uploads.
router.patch('/me/photo', requireAuth, async (req, res) => {
  const { photoData, mimeType } = req.body;
  if (!photoData) return res.status(400).json({ error: 'photoData is required.' });
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePhotoData: photoData, profilePhotoMimeType: mimeType || 'image/jpeg' },
  });
  res.json({ id: updated.id, profilePhotoData: updated.profilePhotoData, profilePhotoMimeType: updated.profilePhotoMimeType });
});

// PATCH /api/auth/me — update own phone number and Onboarding Form details
router.patch('/me', requireAuth, async (req, res) => {
  const { phone, email, dateOfBirth, emergencyContactName, emergencyContactPhone, emergencyContactRelation, currentAddress, permanentAddress, bloodGroup, fatherName, motherName, personalEmail, residenceAddress, customOnboardingValues } = req.body;
  if (email !== undefined) {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== req.user.id) {
      return res.status(400).json({ error: 'Someone else already has that email.' });
    }
  }
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
      // dateOfJoining is deliberately NOT self-editable — that's set by
      // whoever created the account (Admin/HR), not something an
      // employee should be able to change about their own record.
      ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
      ...(emergencyContactName !== undefined ? { emergencyContactName } : {}),
      ...(emergencyContactPhone !== undefined ? { emergencyContactPhone } : {}),
      ...(emergencyContactRelation !== undefined ? { emergencyContactRelation } : {}),
      ...(currentAddress !== undefined ? { currentAddress } : {}),
      ...(permanentAddress !== undefined ? { permanentAddress } : {}),
      ...(bloodGroup !== undefined ? { bloodGroup } : {}),
      ...(fatherName !== undefined ? { fatherName } : {}),
      ...(motherName !== undefined ? { motherName } : {}),
      ...(personalEmail !== undefined ? { personalEmail } : {}),
      ...(residenceAddress !== undefined ? { residenceAddress } : {}),
      ...(customOnboardingValues !== undefined ? { customOnboardingValues } : {}),
    },
  });
  res.json({
    id: user.id, phone: user.phone, email: user.email, dateOfBirth: user.dateOfBirth,
    emergencyContactName: user.emergencyContactName, emergencyContactPhone: user.emergencyContactPhone, emergencyContactRelation: user.emergencyContactRelation,
    currentAddress: user.currentAddress, permanentAddress: user.permanentAddress, bloodGroup: user.bloodGroup,
    fatherName: user.fatherName, motherName: user.motherName, personalEmail: user.personalEmail,
    residenceAddress: user.residenceAddress, customOnboardingValues: user.customOnboardingValues,
  });
});

// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, passwordChangeRateLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ success: true, message: 'Password updated. Please sign in again on other devices.' });
});

const forgotPasswordRateLimit = rateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000, message: 'Too many attempts. Please wait a few minutes and try again.' });

// POST /api/auth/forgot-password
// Body: { email } — no auth required, this IS the "I can't log in" path.
// Generates a brand new password and emails it to that address, same
// pattern already used everywhere else in this app (new employee, new
// student) rather than a token-based reset link, which would need its
// own page and expiry handling. Always responds with the same generic
// message regardless of whether the email matched anything — this is
// deliberate: confirming "yes, that email has an account" to an
// unauthenticated caller lets someone enumerate every registered email
// in the system one guess at a time, which is exactly the kind of
// information a login-adjacent endpoint should never leak.
router.post('/forgot-password', forgotPasswordRateLimit, async (req, res) => {
  const { email } = req.body;
  const genericMessage = 'If that email has an account, a new password has been sent to it.';
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.active) {
    const newPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    const { sendMail } = require('../utils/mailer');
    sendMail({
      to: user.email,
      subject: `Your Dream2Fly password has been reset`,
      body: `Hi ${user.fullName},\n\nYou (or someone using your email) requested a password reset. Here's your new password:\n\n${newPassword}\n\nPlease sign in and change it to something memorable as soon as you can.\n\nIf you didn't request this, contact your admin right away.\n\nBest,\nDream2Fly`,
    }).catch(err => console.error('[forgot-password] Email failed:', err.message));
  }
  res.json({ success: true, message: genericMessage });
});

// PATCH /api/auth/employees/:id/salary — Admin/Super Admin/HR only.
// Body: { baseSalary }
router.patch('/employees/:id/salary', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HR'), async (req, res) => {
  const { baseSalary } = req.body;
  if (baseSalary == null || isNaN(baseSalary)) return res.status(400).json({ error: 'baseSalary must be a number.' });
  const updated = await prisma.user.update({ where: { id: req.params.id }, data: { baseSalary: parseFloat(baseSalary) } });
  res.json({ id: updated.id, baseSalary: updated.baseSalary });
});

// PATCH /api/auth/employees/:id/permissions — Admin/Super Admin only.
// Per-person feature grants, independent of role — the "on/off" toggle
// that lets Admin give any individual access to specific Admin-dashboard
// features (currently: Resignations management, Employee 360,
// Promotions) without changing their role or granting broader access.
router.patch('/employees/:id/permissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { canAccessResignationsAdmin, canAccessEmployee360, canAccessPromotions } = req.body;
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(canAccessResignationsAdmin !== undefined ? { canAccessResignationsAdmin: !!canAccessResignationsAdmin } : {}),
      ...(canAccessEmployee360 !== undefined ? { canAccessEmployee360: !!canAccessEmployee360 } : {}),
      ...(canAccessPromotions !== undefined ? { canAccessPromotions: !!canAccessPromotions } : {}),
    },
    select: { id: true, fullName: true, canAccessResignationsAdmin: true, canAccessEmployee360: true, canAccessPromotions: true },
  });
  const changes = [];
  if (canAccessResignationsAdmin !== undefined) changes.push('Resignations Admin: ' + (canAccessResignationsAdmin ? 'ON' : 'OFF'));
  if (canAccessEmployee360 !== undefined) changes.push('Employee 360: ' + (canAccessEmployee360 ? 'ON' : 'OFF'));
  if (canAccessPromotions !== undefined) changes.push('Promotions: ' + (canAccessPromotions ? 'ON' : 'OFF'));
  if (changes.length) await logActivity(`Permissions changed for ${updated.fullName} — ${changes.join(', ')}.`, req.user.id);
  res.json(updated);
});

// GET /api/auth/employees/:id/certificate — Admin/Super Admin only.
// Generates the official "Channel Partner Certificate" PDF for the given
// partner, live on each request rather than stored — this is meant to
// always reflect current partnership status, unlike a payment receipt
// which must stay frozen at the moment it was issued.
router.get('/employees/:id/certificate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const partner = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });
  if (partner.role !== 'CHANNEL_PARTNER') return res.status(400).json({ error: 'Certificates are only for Channel Partner accounts.' });
  const pdfBuffer = await generatePartnerCertificatePdf({
    partnerName: partner.fullName,
    partnerId: partner.id.slice(-8).toUpperCase(),
    issueDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Dream2Fly-Partner-Certificate-${partner.fullName.replace(/\s+/g, '-')}.pdf"`);
  res.send(pdfBuffer);
});

// GET /api/auth/employees/:id/business-card — Admin/Super Admin only.
// Same auto-fill-from-real-data pattern as the certificate above.
router.get('/employees/:id/business-card', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const partner = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });
  if (partner.role !== 'CHANNEL_PARTNER') return res.status(400).json({ error: 'Business cards are only for Channel Partner accounts.' });
  const pdfBuffer = await generatePartnerBusinessCardPdf({
    partnerName: partner.fullName,
    partnerEmail: partner.email,
    partnerPhone: partner.phone,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Dream2Fly-Partner-BusinessCard-${partner.fullName.replace(/\s+/g, '-')}.pdf"`);
  res.send(pdfBuffer);
});

// GET /api/auth/me/dashboard-access — any authenticated user. Checked
// fresh from the DB (not the JWT) so a revoked grant takes effect
// immediately. Used by the Admin dashboard's auth-guard: Admin/Super
// Admin always get in; anyone else needs at least one Admin-feature
// permission granted to them specifically.
router.get('/me/dashboard-access', requireAuth, async (req, res) => {
  if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) return res.json({ allowed: true });
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { canAccessResignationsAdmin: true, canAccessEmployee360: true, canAccessPromotions: true },
  });
  const allowed = !!(user && (user.canAccessResignationsAdmin || user.canAccessEmployee360 || user.canAccessPromotions));
  res.json({ allowed, permissions: user });
});

// GET /api/auth/employees — Admin/Super Admin only. Used for dropdowns
// (payslip upload, asset assignment, etc.) and now also shows each
// person's current reporting manager, for the admin assignment UI.
// GET /api/auth/employees — Admin/Super Admin, or anyone granted either
// Admin-feature permission (both Resignations and Employee 360 need this
// list for their dropdowns).
// GET /api/auth/students-search?q=... — Admin/Super Admin/Employee/
// Counsellor/Manager. Powers the student autocomplete in the payment
// request form (and anywhere else staff need to find a student by name
// or email without typing the exact address from memory). Deliberately
// narrow — only id/fullName/email, none of the HR-sensitive fields
// GET /employees exposes, so it's safe to open up to regular staff
// instead of restricting it to Admin/Super Admin like that one is.
router.get('/students-search', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      active: true,
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, fullName: true, email: true },
    take: 8,
    orderBy: { fullName: 'asc' },
  });
  res.json(students);
});

// GET /api/auth/onboarding-directory?role=EMPLOYEE|CHANNEL_PARTNER — Admin/Super
// Admin only. The full picture across everyone's Onboarding Form at
// once — this is deliberately a separate endpoint from GET /employees
// above (which many dropdowns/pickers call constantly) rather than
// bloating every one of those calls with every onboarding field just
// for this one directory view.
router.get('/onboarding-directory', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { role } = req.query;
  const roleFilter = role === 'CHANNEL_PARTNER' ? ['CHANNEL_PARTNER']
    : role === 'EMPLOYEE' ? ['EMPLOYEE', 'COUNSELLOR', 'MANAGER', 'HR', 'FINANCE', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER', 'ADMIN', 'SUPER_ADMIN']
    : ['EMPLOYEE', 'COUNSELLOR', 'MANAGER', 'HR', 'FINANCE', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER', 'ADMIN', 'SUPER_ADMIN', 'CHANNEL_PARTNER'];
  const people = await prisma.user.findMany({
    where: { role: { in: roleFilter }, active: true },
    select: {
      id: true, fullName: true, role: true, jobTitle: true, email: true, phone: true,
      dateOfBirth: true, dateOfJoining: true, fatherName: true, motherName: true, bloodGroup: true,
      personalEmail: true, currentAddress: true, residenceAddress: true,
      emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true,
      customOnboardingValues: true,
    },
    orderBy: { fullName: 'asc' },
  });
  const customFields = await prisma.onboardingFieldDefinition.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  res.json({ people, customFields });
});

router.get('/employees', requireAuth, async (req, res) => {
  if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    let allowed = false;
    if (req.user.role === 'HR') {
      const settings = await prisma.roleCapabilitySettings.findUnique({ where: { id: 'singleton' } });
      allowed = !settings || settings.hrSeesResignations !== false || settings.hrSeesEmployee360 !== false;
    }
    if (!allowed) {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { canAccessResignationsAdmin: true, canAccessEmployee360: true, canAccessPromotions: true } });
      allowed = !!(user && (user.canAccessResignationsAdmin || user.canAccessEmployee360 || user.canAccessPromotions));
    }
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
  }
  // Defaults to active-only, matching every existing caller (assignee
  // dropdowns, reporting structure, etc.) — those must never show a
  // deactivated person as assignable. Only the account-management view
  // (Enable/Disable, Reset Password) needs to see everyone, and passes
  // ?includeInactive=1 explicitly to opt into that.
  const includeInactive = req.query.includeInactive === '1';
  const employees = await prisma.user.findMany({
    where: includeInactive ? {} : { active: true },
    select: { id: true, fullName: true, email: true, phone: true, role: true, active: true, reportingManagerId: true, reportingManager: { select: { fullName: true } }, baseSalary: true, canAccessResignationsAdmin: true, canAccessEmployee360: true, canAccessPromotions: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(employees);
});

// POST /api/auth/employees — Admin/Super Admin only. Creates a real staff
// account (as opposed to scripts/create-user.js, which needed shell
// access). Requires name, email, and a starting password; phone and role
// are optional (role defaults to EMPLOYEE). Emails the new person their
// login so nothing has to be relayed manually.
router.post('/employees', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { fullName, email, phone, password, role, jobTitle, reportingManagerId } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and a starting password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: 'Someone with that email already has an account.' });
  }
  const chosenRole = role && VALID_ROLES.includes(role) ? role : 'EMPLOYEE';
  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: { fullName, email, phone: phone || null, passwordHash, role: chosenRole, jobTitle: jobTitle || null, reportingManagerId: reportingManagerId || null },
  });
  await logActivity(`${req.user.fullName} added ${fullName} as a new ${chosenRole.replace('_', ' ').toLowerCase()}.`, req.user.id);
  const { sendMail } = require('../utils/mailer');
  sendMail({
    to: email,
    subject: `Your Dream2Fly account is ready`,
    body: `Hi ${fullName},\n\nYou've been added to Dream2Fly's system. Here's how to sign in:\n\nPortal: https://dream2fly.co.uk/login.html\nEmail: ${email}\nPassword: ${password}\n\nPlease sign in and change your password as soon as you can.\n\nBest,\nDream2Fly`,
  }).catch(err => console.error('[employees/create] Welcome email failed:', err.message));
  res.status(201).json({ id: created.id, fullName: created.fullName, email: created.email, role: created.role });
});

// PATCH /api/auth/employees/:id — Admin/Super Admin only. Edits the basic
// profile fields for someone else's account (name/email/phone/jobTitle).
// Role, salary, reporting manager, and permissions each have their own
// dedicated endpoints above/below — kept separate so each change is
// individually logged and permission-checked rather than one big
// catch-all update.
router.patch('/employees/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { fullName, email, phone, jobTitle, dateOfBirth, dateOfJoining, emergencyContactName, emergencyContactPhone, emergencyContactRelation, currentAddress, permanentAddress, bloodGroup } = req.body;
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (email && email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Someone else already has that email.' });
  }
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(jobTitle !== undefined ? { jobTitle } : {}),
      ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
      ...(dateOfJoining !== undefined ? { dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null } : {}),
      ...(emergencyContactName !== undefined ? { emergencyContactName } : {}),
      ...(emergencyContactPhone !== undefined ? { emergencyContactPhone } : {}),
      ...(emergencyContactRelation !== undefined ? { emergencyContactRelation } : {}),
      ...(currentAddress !== undefined ? { currentAddress } : {}),
      ...(permanentAddress !== undefined ? { permanentAddress } : {}),
      ...(bloodGroup !== undefined ? { bloodGroup } : {}),
    },
  });
  await logActivity(`${req.user.fullName} updated ${target.fullName}'s profile details.`, req.user.id);
  res.json({
    id: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, jobTitle: updated.jobTitle,
    dateOfBirth: updated.dateOfBirth, dateOfJoining: updated.dateOfJoining,
    emergencyContactName: updated.emergencyContactName, emergencyContactPhone: updated.emergencyContactPhone, emergencyContactRelation: updated.emergencyContactRelation,
    currentAddress: updated.currentAddress, permanentAddress: updated.permanentAddress, bloodGroup: updated.bloodGroup,
  });
});

// PATCH /api/auth/employees/:id/deactivate — Admin/Super Admin only. Soft
// delete: keeps their historical records (leads, comments, payslips) intact
// but blocks login and removes them from notification/assignment lists.
// Same last-Super-Admin guardrail as the role-change endpoint.
router.patch('/employees/:id/deactivate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'SUPER_ADMIN') {
    const otherSuperAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN', active: true, id: { not: target.id } } });
    if (otherSuperAdmins === 0) {
      return res.status(400).json({ error: 'Cannot deactivate the only active Super Admin.' });
    }
  }
  await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
  await logActivity(`${req.user.fullName} deactivated ${target.fullName}'s account.`, req.user.id);
  res.json({ success: true });
});

// PATCH /api/auth/employees/:id/reactivate — Admin/Super Admin only.
// Undoes a deactivation — the account can sign in again immediately.
router.patch('/employees/:id/reactivate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await prisma.user.update({ where: { id: req.params.id }, data: { active: true } });
  await logActivity(`${req.user.fullName} re-enabled ${target.fullName}'s account.`, req.user.id);
  res.json({ success: true });
});

// PATCH /api/auth/employees/:id/reset-password — resets someone else's
// password (as opposed to /change-password, which is for your own).
// Body: { newPassword? } — if omitted, a random one is generated. Either
// way the person is emailed their new password. Permission is tiered:
// resetting a STUDENT's password is allowed for any staff member who
// regularly works with students (Employee/Counsellor/Manager/Admin/Super
// Admin) — they're often the ones fielding "I can't log in" directly from
// a candidate. Resetting anyone else's (staff/partner) password is
// restricted to Admin/Super Admin, since that's a more sensitive action.
router.patch('/employees/:id/reset-password', requireAuth, async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const allowedRoles = target.role === 'STUDENT'
    ? ['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'COUNSELLOR', 'MANAGER']
    : ['ADMIN', 'SUPER_ADMIN'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to reset this account\'s password.' });
  }
  const { newPassword } = req.body;
  const finalPassword = newPassword && newPassword.length >= 8 ? newPassword : Math.random().toString(36).slice(-10) + 'A1!';
  const passwordHash = await bcrypt.hash(finalPassword, 10);
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash } });
  await logActivity(`${req.user.fullName} reset ${target.fullName}'s password.`, req.user.id);
  const { sendMail } = require('../utils/mailer');
  sendMail({
    to: target.email,
    subject: `Your Dream2Fly password has been reset`,
    body: `Hi ${target.fullName},\n\nYour password was reset by ${req.user.fullName}. Here's your new password:\n\n${finalPassword}\n\nPlease sign in and change it to something memorable as soon as you can.\n\nPortal: https://dream2fly.co.uk/login.html\n\nIf this wasn't expected, contact your admin right away.\n\nBest,\nDream2Fly`,
  }).catch(err => console.error('[reset-password] Email failed:', err.message));
  res.json({ success: true, newPassword: finalPassword });
});

// PATCH /api/auth/employees/:id/reporting-manager — Admin/Super Admin only.
// Body: { reportingManagerId } (can be null to clear it)
router.patch('/employees/:id/reporting-manager', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { reportingManagerId } = req.body;
  if (reportingManagerId === req.params.id) {
    return res.status(400).json({ error: 'A person cannot be their own reporting manager.' });
  }
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { reportingManagerId: reportingManagerId || null },
  });
  res.json(updated);
});

// PATCH /api/auth/employees/:id/role — Admin/Super Admin only. Assign or
// change anyone's role. One guardrail: refuses to demote the very last
// active Super Admin, since that would lock everyone out of the account
// that can undo mistakes — everything else is left to Admin's judgment,
// since this is meant to be full, direct control.
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'FINANCE', 'COUNSELLOR', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER', 'EMPLOYEE', 'CHANNEL_PARTNER', 'STUDENT'];
router.patch('/employees/:id/role', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Not a valid role.' });
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
    const otherSuperAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN', active: true, id: { not: target.id } } });
    if (otherSuperAdmins === 0) {
      return res.status(400).json({ error: 'Cannot change this — they are the only active Super Admin. Assign the role to someone else first.' });
    }
  }
  const updated = await prisma.user.update({ where: { id: target.id }, data: { role } });
  await logActivity(`${req.user.fullName} changed ${target.fullName}'s role from ${target.role} to ${role}.`, req.user.id);
  res.json({ id: updated.id, role: updated.role });
});

// GET /api/auth/me/team — any signed-in user. Shows who to go to: their
// reporting manager, plus the active HR contact(s) — but HR contacts
// only for internal staff. A Channel Partner is an external business
// relationship, not someone with an HR relationship to this company —
// showing them HR's personal phone/email wasn't a deliberate design
// choice, just something that had never been scoped down.
router.get('/me/team', requireAuth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { reportingManager: { select: { fullName: true, email: true, phone: true, jobTitle: true } } },
  });
  const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'HR', 'FINANCE', 'COUNSELLOR', 'VISA_OFFICER', 'DOCUMENTATION_OFFICER', 'EMPLOYEE'];
  const hrContacts = STAFF_ROLES.includes(req.user.role)
    ? await prisma.user.findMany({ where: { role: 'HR', active: true }, select: { fullName: true, email: true, phone: true } })
    : [];
  res.json({ reportingManager: me.reportingManager, hrContacts });
});

// GET /api/auth/employees/:id/full-profile — Admin/Super Admin/HR only.
// Everything about one employee on a single screen: profile, tenure,
// resignation status, full payslip history, attendance month-by-month,
// documents (agreements/onboarding), and assigned assets. Built for the
// "search one employee, see everything" requirement — especially useful
// once someone has resigned, to pull their full record in one place.
router.get('/employees/:id/full-profile', requireAuth, requireHrCapability('hrSeesEmployee360', requirePermission('canAccessEmployee360', 'ADMIN', 'SUPER_ADMIN')), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { reportingManager: { select: { fullName: true } } },
  });
  if (!user) return res.status(404).json({ error: 'Employee not found.' });

  const resignations = await prisma.resignation.findMany({ where: { userId: user.id }, orderBy: { requestedAt: 'desc' } });
  const latestResignation = resignations[0] || null;

  const payslips = await prisma.payslip.findMany({
    where: { userId: user.id },
    select: { id: true, month: true, netPay: true, daysPresent: true, daysAbsent: true, daysOnLeave: true, isAutoCalculated: true, createdAt: true },
    orderBy: { month: 'asc' },
  });
  const totalSalaryPaid = payslips.reduce((sum, p) => sum + (p.netPay || 0), 0);

  const attendanceRows = await prisma.attendance.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } });
  const attendanceByMonth = {};
  for (const a of attendanceRows) {
    const monthKey = a.date.toISOString().slice(0, 7);
    if (!attendanceByMonth[monthKey]) attendanceByMonth[monthKey] = { present: 0, absent: 0, halfDay: 0, onLeave: 0, workFromHome: 0 };
    const bucket = attendanceByMonth[monthKey];
    if (a.status === 'PRESENT') bucket.present++;
    else if (a.status === 'ABSENT') bucket.absent++;
    else if (a.status === 'HALF_DAY') bucket.halfDay++;
    else if (a.status === 'ON_LEAVE') bucket.onLeave++;
    else if (a.status === 'WORK_FROM_HOME') bucket.workFromHome++;
  }

  const documentAcks = await prisma.signableDocumentAck.findMany({
    where: { userId: user.id },
    include: { document: { select: { title: true, category: true } } },
  });

  const assetAssignments = await prisma.assetAssignment.findMany({
    where: { userId: user.id },
    include: { asset: { select: { name: true, category: true } } },
    orderBy: { assignedAt: 'desc' },
  });

  const tenureStart = user.createdAt;
  const tenureEnd = latestResignation && latestResignation.status === 'APPROVED' && latestResignation.actualLastWorkingDay
    ? latestResignation.actualLastWorkingDay
    : new Date();
  const tenureMonths = Math.max(0, Math.round((tenureEnd - tenureStart) / (1000 * 60 * 60 * 24 * 30.44)));

  res.json({
    profile: {
      id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, jobTitle: user.jobTitle,
      role: user.role, active: user.active, baseSalary: user.baseSalary,
      reportingManager: user.reportingManager ? user.reportingManager.fullName : null,
      joinedAt: user.createdAt,
    },
    tenure: { months: tenureMonths, startedAt: tenureStart, endedAt: latestResignation && latestResignation.status === 'APPROVED' ? tenureEnd : null },
    resignations,
    payslips,
    totalSalaryPaid,
    attendanceByMonth,
    documents: documentAcks,
    assets: assetAssignments,
  });
});

module.exports = router;
