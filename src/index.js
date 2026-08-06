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
});
