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

async function sendMail({ to, subject, body, attachmentFileName, attachmentBase64, attachmentMimeType }) {
  if (!transporter) {
    console.log('--- EMAIL (SMTP not configured, logging instead) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(body);
    if (attachmentFileName) console.log('(Would attach:', attachmentFileName, ')');
    console.log('-----------------------------------------------------');
    return { delivered: false, logged: true };
  }
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Dream2Fly <no-reply@dream2fly.co.uk>',
    to,
    subject,
    text: body,
  };
  if (attachmentFileName && attachmentBase64) {
    mailOptions.attachments = [{
      filename: attachmentFileName,
      content: attachmentBase64.includes(',') ? attachmentBase64.split(',')[1] : attachmentBase64,
      encoding: 'base64',
      contentType: attachmentMimeType || 'application/octet-stream',
    }];
  }
  await transporter.sendMail(mailOptions);
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

// Task-stage templates — the post-conversion pipeline (document checklist
// through visa approval). Separate from the lead status templates above
// since the wording is deliberately different once someone is a paying
// candidate, not just a prospect.
const taskStageTemplates = {
  DOC_CHECKLIST_SENT: { subject: 'Your document checklist', body: 'Hi {{name}},\n\nWe have sent over your document checklist. Please review and start gathering the listed items.\n\nBest,\nDream2Fly Team' },
  WAITING_FOR_DOCUMENTS: { subject: 'Waiting on a few documents from you', body: 'Hi {{name}},\n\nWe are still waiting on a few documents from you to keep things moving. Please upload them at your earliest convenience.\n\nBest,\nDream2Fly Team' },
  DOCUMENTS_RECEIVED: { subject: 'Documents received', body: 'Hi {{name}},\n\nThank you — we have received your documents and are reviewing them now.\n\nBest,\nDream2Fly Team' },
  SUBMITTED_TO_UNIVERSITY: { subject: 'Your application has been submitted', body: 'Hi {{name}},\n\nGreat news — your application has been submitted to the university.\n\nBest,\nDream2Fly Team' },
  WAITING_UNIVERSITY_RESPONSE: { subject: 'Waiting on the university', body: 'Hi {{name}},\n\nYour application is with the university now. We are waiting on their response and will update you as soon as we hear back.\n\nBest,\nDream2Fly Team' },
  PENDING_FROM_CANDIDATE: { subject: 'Action needed from you', body: 'Hi {{name}},\n\nWe need something from you to keep this moving forward. Please check your portal or get in touch with your counsellor.\n\nBest,\nDream2Fly Team' },
  PENDING_FROM_CLIENT: { subject: 'Update on your case', body: 'Hi {{name}},\n\nThis is currently pending on our client\'s side. We will update you as soon as there is progress.\n\nBest,\nDream2Fly Team' },
  PENDING_FROM_UNIVERSITY: { subject: 'Waiting on the university', body: 'Hi {{name}},\n\nThis is currently pending a response from the university. We will let you know as soon as we hear back.\n\nBest,\nDream2Fly Team' },
  INTERVIEW_STAGE: { subject: 'Interview stage', body: 'Hi {{name}},\n\nYour case has moved to the interview stage. Your counsellor will be in touch with details shortly.\n\nBest,\nDream2Fly Team' },
  LOAN_STAGE: { subject: 'Loan processing stage', body: 'Hi {{name}},\n\nWe are now working on the loan process for your case.\n\nBest,\nDream2Fly Team' },
  VISA_STAGE: { subject: 'Visa application stage', body: 'Hi {{name}},\n\nYour case has moved to the visa application stage.\n\nBest,\nDream2Fly Team' },
  VISA_APPROVED: { subject: 'Congratulations — visa approved!', body: 'Hi {{name}},\n\nWonderful news — your visa has been approved! Our team will be in touch with your pre-departure checklist.\n\nBest,\nDream2Fly Team' },
  COMPLETED: { subject: 'Your case is complete', body: 'Hi {{name}},\n\nYour case has now been completed. Congratulations, and thank you for choosing Dream2Fly!\n\nBest,\nDream2Fly Team' },
};
function renderTaskStageTemplate(stage, name) {
  const t = taskStageTemplates[stage] || { subject: 'Update on your case', body: `Hi {{name}},\n\nYour case has moved to the ${stage} stage.\n\nBest,\nDream2Fly Team` };
  return { subject: t.subject, body: t.body.replace(/{{name}}/g, name) };
}

// Quick, one-off candidate messages an employee can send anytime from a
// task's job card — not tied to a status/stage change, just routine
// communication (chasing documents, a general check-in, or an important
// alert). Separate from the automated stage-change emails above.
const quickCandidateTemplates = {
  DOCUMENTS_PENDING: { subject: 'Documents needed', body: 'Hi {{name}},\n\nWe are still waiting on a few documents from you. Please share them at your earliest convenience so we can keep things moving.\n\nBest,\nDream2Fly Team' },
  GENERAL_UPDATE: { subject: 'A quick update on your case', body: 'Hi {{name}},\n\nJust a quick update — your case is progressing well. We will let you know as soon as there is more news.\n\nBest,\nDream2Fly Team' },
  ALERT: { subject: 'Important update needed', body: 'Hi {{name}},\n\nThis is an important update regarding your case. Please get in touch with your counsellor at your earliest convenience.\n\nBest,\nDream2Fly Team' },
};
function renderQuickCandidateTemplate(template, name) {
  const t = quickCandidateTemplates[template] || quickCandidateTemplates.GENERAL_UPDATE;
  return { subject: t.subject, body: t.body.replace(/{{name}}/g, name) };
}

module.exports = { sendMail, renderTemplate, statusEmailTemplates, taskStageTemplates, renderTaskStageTemplate, quickCandidateTemplates, renderQuickCandidateTemplate };
