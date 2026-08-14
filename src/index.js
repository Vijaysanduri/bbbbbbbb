require('dotenv').config();
const express = require('express');
require('express-async-errors');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const leadsRoutes = require('./routes/leads.routes');
const tasksRoutes = require('./routes/tasks.routes');
const featureFlagsRoutes = require('./routes/featureFlags.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const leavesRoutes = require('./routes/leaves.routes');
const infoDocumentsRoutes = require('./routes/infoDocuments.routes');
const emailTemplatesRoutes = require('./routes/emailTemplates.routes');
const careerApplicationsRoutes = require('./routes/careerApplications.routes');
const taskStagesRoutes = require('./routes/taskStages.routes');
const mediaRoutes = require('./routes/media.routes');
const themeRoutes = require('./routes/theme.routes');
const documentTemplatesRoutes = require('./routes/documentTemplates.routes');
const searchRoutes = require('./routes/search.routes');
const payslipsRoutes = require('./routes/payslips.routes');
const siteContentRoutes = require('./routes/siteContent.routes');
const payrollRoutes = require('./routes/payroll.routes');
const holidaysRoutes = require('./routes/holidays.routes');
const assetsRoutes = require('./routes/assets.routes');
const signableDocumentsRoutes = require('./routes/signableDocuments.routes');
const notesRoutes = require('./routes/notes.routes');
const partnerFinanceRoutes = require('./routes/partnerFinance.routes');
const resignationsRoutes = require('./routes/resignations.routes');
const partnerDocsRoutes = require('./routes/partnerDocs.routes');
const expensesRoutes = require('./routes/expenses.routes');
const roleSettingsRoutes = require('./routes/roleSettings.routes');
const chatRoutes = require('./routes/chat.routes');
const activityLogRoutes = require('./routes/activityLog.routes');
const reportsRoutes = require('./routes/reports.routes');
const studentDocsRoutes = require('./routes/studentDocs.routes');
const promotionsRoutes = require('./routes/promotions.routes');
const paymentsRoutes = require('./routes/payments.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy — needed so req.ip is the real client, not the proxy, which matters for rate limiting below

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));
app.use(express.json());

// Basic security headers — the concrete equivalent of what helmet.js
// would set, without adding a new dependency for a handful of headers.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // stops browsers guessing content types in a way that can enable attacks
  res.setHeader('X-Frame-Options', 'DENY'); // stops this site being embedded in someone else's iframe (clickjacking)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // forces HTTPS on repeat visits
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'dream2fly-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/feature-flags', featureFlagsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/info-documents', infoDocumentsRoutes);
app.use('/api/email-templates', emailTemplatesRoutes);
app.use('/api/career-applications', careerApplicationsRoutes);
app.use('/api/task-stages', taskStagesRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/theme', themeRoutes);
app.use('/api/document-templates', documentTemplatesRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/payslips', payslipsRoutes);
app.use('/api/site-content', siteContentRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/signable-documents', signableDocumentsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/partner-finance', partnerFinanceRoutes);
app.use('/api/resignations', resignationsRoutes);
app.use('/api/partner-docs', partnerDocsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/role-settings', roleSettingsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/activity-log', activityLogRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/student-docs', studentDocsRoutes);
app.use('/api/promotions', promotionsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Centralized error handler — keeps stack traces out of API responses.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong on our end.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Dream2Fly backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);

  // Lead SLA scheduler — auto-assigns unassigned leads after 30 minutes,
  // escalates uncontacted assigned leads after 30 minutes, and sends the
  // daily standup digest. Runs in-process every 5 minutes; this only works
  // because Railway keeps this Node process running continuously — it
  // would need a real cron/job-queue setup on a serverless platform.
  const { runSlaChecks } = require('./utils/slaScheduler');
  setInterval(runSlaChecks, 5 * 60 * 1000);
  runSlaChecks(); // also run once at startup, don't wait 5 minutes for the first pass

  // Weekly reminders — document signing and overdue payments. Checks
  // once a day (cheap, no-op most days) and only actually sends once 7+
  // days have passed since someone's last reminder, so it naturally
  // staggers correctly regardless of when the server happens to restart.
  const { runScheduledReminders } = require('./utils/scheduler');
  setInterval(runScheduledReminders, 24 * 60 * 60 * 1000);
  setTimeout(runScheduledReminders, 60 * 1000); // give the server a minute to settle before the first check

  // One-time starter set for the candidate-email "Quick template" library
  // — only runs if the table is empty, so this never overwrites templates
  // once someone starts editing/adding their own. Content here is
  // deliberately generic starter text with [bracketed] placeholders
  // where the real specifics (which documents, which lender, which visa
  // category) need Dream2Fly's actual process filled in — these are
  // meant to be reviewed and customized via Manage Templates, not sent
  // to a candidate as-is.
  seedStarterEmailTemplates();
  seedStarterTaskStages();
});

async function seedStarterEmailTemplates() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const count = await prisma.emailTemplate.count();
    if (count > 0) return;
    const starters = [
      { name: 'Introduction — About Dream2Fly', subject: 'Welcome to Dream2Fly — here\'s how we\'ll work together',
        body: 'Hi {{name}},\n\nThank you for reaching out to Dream2Fly Consulting. We help students with the full journey — university/course selection, application, visa filing, and settling in once you arrive.\n\nYour dedicated counsellor will guide you step by step, and you can always reach us here or by phone.\n\nLooking forward to helping you get there.\n\nBest,\nDream2Fly Team' },
      { name: 'Checklist — Document Collection', subject: 'Documents we\'ll need from you',
        body: 'Hi {{name}},\n\nTo get your application moving, please share the following as soon as you can:\n\n- [Passport copy]\n- [Academic transcripts and certificates]\n- [English test score, if available]\n- [Updated CV]\n- [Any other document specific to your course/destination]\n\nYou can upload these directly in your student portal, or reply here.\n\nBest,\nDream2Fly Team' },
      { name: 'Pending Documents Reminder', subject: 'Still waiting on a few documents from you',
        body: 'Hi {{name}},\n\nJust a quick reminder — we\'re still waiting on the following before we can move ahead:\n\n- [Document 1]\n- [Document 2]\n\nPlease share these at your earliest convenience so we don\'t lose time on your application.\n\nBest,\nDream2Fly Team' },
      { name: 'Loan Checklist', subject: 'Documents needed for your education loan',
        body: 'Hi {{name}},\n\nHere\'s what most lenders will ask for to process your education loan:\n\n- [Admission/Offer letter]\n- [Co-applicant\'s income proof]\n- [Identity and address proof]\n- [Academic records]\n- [Bank statements — last 6 months]\n\nLet us know if you\'d like us to connect you with our partner lenders.\n\nBest,\nDream2Fly Team' },
      { name: 'Visa Filing Form', subject: 'Next step — visa filing',
        body: 'Hi {{name}},\n\nCongratulations on reaching the visa stage! To file your application, we\'ll need:\n\n- [CAS/I-20 or equivalent confirmation]\n- [Proof of funds]\n- [Passport]\n- [Completed visa application form — attached/linked here]\n\nPlease review and get these back to us so we can file without delay.\n\nBest,\nDream2Fly Team' },
      { name: 'Visa Biometric Checklist', subject: 'What to bring to your biometric appointment',
        body: 'Hi {{name}},\n\nYour biometric appointment is coming up. Please bring:\n\n- [Passport]\n- [Appointment confirmation]\n- [Visa application reference number]\n- [Any supporting documents requested for your specific visa category]\n\nArrive at least [X] minutes early. Let us know if you need to reschedule.\n\nBest,\nDream2Fly Team' },
      { name: 'Travelling Checklist', subject: 'Getting ready to fly — your pre-departure checklist',
        body: 'Hi {{name}},\n\nExciting times! Before you travel, make sure you have:\n\n- [Passport and visa]\n- [CAS/I-20 and offer letter — physical copies]\n- [Proof of accommodation]\n- [Sufficient funds/proof of funds documents]\n- [Local currency for initial expenses]\n- [Emergency contact list, including Dream2Fly\'s]\n\nSafe travels — we\'re here if anything comes up.\n\nBest,\nDream2Fly Team' },
    ];
    for (const t of starters) {
      await prisma.emailTemplate.create({ data: t });
    }
    console.log(`Seeded ${starters.length} starter email templates.`);
  } catch (err) {
    console.error('Could not seed starter email templates:', err.message);
  }
}

async function seedStarterTaskStages() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const count = await prisma.taskStageOption.count();
    if (count > 0) return;
    // These first 13 are the EXACT original enum key strings this project
    // used before stages became admin-editable — preserving them exactly
    // (not converting to nicer display names) keeps every existing task's
    // stored `stage` value valid, and keeps the stage-change email
    // templates in utils/mailer.js (keyed on these same strings) matching
    // correctly. New stages added from here on can be named however
    // makes sense — "Offer Received" is the one explicitly requested that
    // didn't already exist under any name.
    const starters = [
      'DOC_CHECKLIST_SENT', 'WAITING_FOR_DOCUMENTS', 'DOCUMENTS_RECEIVED',
      'SUBMITTED_TO_UNIVERSITY', 'WAITING_UNIVERSITY_RESPONSE',
      'PENDING_FROM_CANDIDATE', 'PENDING_FROM_CLIENT', 'PENDING_FROM_UNIVERSITY',
      'INTERVIEW_STAGE', 'LOAN_STAGE', 'VISA_STAGE', 'VISA_APPROVED', 'COMPLETED',
      'Offer Received',
    ];
    for (let i = 0; i < starters.length; i++) {
      await prisma.taskStageOption.create({ data: { name: starters[i], order: i } });
    }
    console.log(`Seeded ${starters.length} starter task stages.`);
  } catch (err) {
    console.error('Could not seed starter task stages:', err.message);
  }
}
