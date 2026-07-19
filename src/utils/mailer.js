const nodemailer = require('nodemailer');

// If SMTP settings are provided in .env, real emails are sent.
// Otherwise, emails are logged to the console — safe default for local dev,
// and means you can build/test the whole flow before wiring a real inbox.
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

async function sendMail({ to, subject, body }) {
  if (!transporter) {
    console.log('--- EMAIL (SMTP not configured, logging instead) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(body);
    console.log('-----------------------------------------------------');
    return { delivered: false, logged: true };
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Dream2Fly <no-reply@dream2fly.co.uk>',
    to,
    subject,
    text: body
  });
  return { delivered: true };
}

// Default templates keyed by status — same content as the front-end
// prototype's emailTemplates map, now living server-side so every client
// (web, mobile) gets consistent wording. Section "System Settings > Email
// Templates" in the admin portal should eventually let admins edit these
// via the database instead of hardcoding them here.
const statusEmailTemplates = {
  DOCUMENTS_PENDING: { subject: 'Documents needed for your application', body: 'Hi {{name}},\n\nWe still need a few documents from you to move your application forward.\n\nBest,\nDream2Fly Team' },
  UNDER_REVIEW: { subject: 'Your application is under review', body: 'Hi {{name}},\n\nYour application is currently being reviewed by our team.\n\nBest,\nDream2Fly Team' },
  OFFER_RECEIVED: { subject: 'Good news — you have an offer!', body: 'Hi {{name}},\n\nCongratulations! You have received an offer.\n\nBest,\nDream2Fly Team' },
  VISA_FILED: { subject: 'Your visa application has been submitted', body: 'Hi {{name}},\n\nYour visa application has been submitted.\n\nBest,\nDream2Fly Team' },
  VISA_APPROVED: { subject: 'Congratulations — your visa is approved!', body: 'Hi {{name}},\n\nGreat news — your visa has been approved.\n\nBest,\nDream2Fly Team' },
  VISA_REFUSED: { subject: 'Update on your visa application', body: 'Hi {{name}},\n\nYour visa application was not approved this time. Our counsellor will call you shortly.\n\nBest,\nDream2Fly Team' },
  CONVERTED: { subject: 'Welcome aboard!', body: 'Hi {{name}},\n\nThank you for choosing Dream2Fly. Your case is now being actively processed.\n\nBest,\nDream2Fly Team' },
  PENDING: { subject: 'Update on your request', body: 'Hi {{name}},\n\nYour request is pending action from our side.\n\nBest,\nDream2Fly Team' },
  IN_PROGRESS: { subject: 'We are working on it', body: 'Hi {{name}},\n\nJust a note to let you know we are actively working on this.\n\nBest,\nDream2Fly Team' },
  COMPLETED: { subject: 'This item has been completed', body: 'Hi {{name}},\n\nThis item has been completed on our end.\n\nBest,\nDream2Fly Team' },
  OVERDUE: { subject: 'Action needed on your application', body: 'Hi {{name}},\n\nWe need action from your side to avoid delays.\n\nBest,\nDream2Fly Team' }
};

function renderTemplate(status, name) {
  const t = statusEmailTemplates[status] || {
    subject: 'Update on your application',
    body: `Hi {{name}},\n\nYour status has been updated to ${status}.\n\nBest,\nDream2Fly Team`
  };
  return { subject: t.subject, body: t.body.replace(/{{name}}/g, name) };
}

module.exports = { sendMail, renderTemplate, statusEmailTemplates };
