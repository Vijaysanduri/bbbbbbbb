// Wraps a plain-text email body in a branded HTML template — the exact
// same header/footer banner images used on the onboarding documents
// (hosted on the website, not embedded as base64, so emails stay small
// and render reliably across mail clients), with the message in between.
// Plain-text \n\n becomes a new paragraph; single \n becomes a line break.
const SITE_BASE_URL = 'https://dream2fly.co.uk';

// ---- Design A: full illustrated letterhead (world map, skyline, service icons) ----
function wrapEmailHtmlDesignA(subject, bodyText) {
  const paragraphs = bodyText.split(/\n\n+/).map(block =>
    '<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#333333;">' +
      block.split('\n').map(line => escapeHtml(line)).join('<br>') +
    '</p>'
  ).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f4f4f7; font-family:'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7; padding:30px 12px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
        <tr><td>
          <img src="${SITE_BASE_URL}/images/email/header-banner.png" alt="Dream2Fly Consulting Services Limited" width="600" style="display:block; width:100%; max-width:600px; height:auto;">
        </td></tr>
        <tr><td style="padding:10px 28px 4px;">
          <div style="font-size:17px; font-weight:700; color:#0B1F4D; text-align:center; padding-bottom:14px; border-bottom:3px solid #F6C221;">${escapeHtml(subject)}</div>
        </td></tr>
        <tr><td style="background:#ffffff; padding:24px 28px 8px;">
          ${paragraphs}
        </td></tr>
        <tr><td>
          <img src="${SITE_BASE_URL}/images/email/footer-banner.png" alt="Dream2Fly Consulting Services Limited — Hyderabad, Vijayawada, London" width="600" style="display:block; width:100%; max-width:600px; height:auto;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
// ---- Design B: flat gold banner + logo/name + dark subtitle bar (matches
// the simpler "colored banner with company name, subtitle bar below" style
// requested as a second option) — footer stays the same branded banner
// image as Design A, for visual consistency between the two. ----
function wrapEmailHtmlDesignB(subject, bodyText) {
  const paragraphs = bodyText.split(/\n\n+/).map(block =>
    '<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#333333;">' +
      block.split('\n').map(line => escapeHtml(line)).join('<br>') +
    '</p>'
  ).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f4f4f7; font-family:'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7; padding:30px 12px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
        <tr><td style="background:#F6C221; padding:34px 24px 28px; text-align:center;">
          <img src="${SITE_BASE_URL}/images/email/logo-mark.png" width="52" height="45" alt="Dream2Fly" style="display:block; margin:0 auto 10px;">
          <div style="font-size:26px; font-weight:800; color:#0B1F4D; letter-spacing:0.5px;">DREAM<span style="color:#A11D24;">2</span>FLY</div>
          <div style="font-size:11px; font-weight:700; color:#0B1F4D; letter-spacing:2px; margin-top:2px;">CONSULTING SERVICES LIMITED</div>
        </td></tr>
        <tr><td style="background:#0B1F4D; padding:16px 24px; text-align:center;">
          <div style="font-size:16px; font-weight:700; color:#ffffff;">${escapeHtml(subject)}</div>
        </td></tr>
        <tr><td style="background:#ffffff; padding:28px 28px 8px;">
          ${paragraphs}
        </td></tr>
        <tr><td>
          <img src="${SITE_BASE_URL}/images/email/footer-banner.png" alt="Dream2Fly Consulting Services Limited — Hyderabad, Vijayawada, London" width="600" style="display:block; width:100%; max-width:600px; height:auto;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Sends via Resend's HTTP API (https://resend.com) rather than raw SMTP.
// Cloud hosts like Railway commonly block outbound SMTP ports (25/465/587)
// to prevent spam abuse — that showed up here as ETIMEDOUT on every SMTP
// connection attempt, from both live requests and the background SLA
// reminder scheduler. Resend uses plain HTTPS (port 443), which is never
// blocked, so this sidesteps the problem entirely instead of tuning
// timeouts around it. Needs RESEND_API_KEY set as an environment variable
// (from resend.com/api-keys) to actually send. Without it, this logs
// instead — same safe-fallback pattern as before.
function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function sendMail({ to, subject, body, attachmentFileName, attachmentBase64, attachmentMimeType }) {
  if (!isConfigured()) {
    console.log('--- EMAIL (RESEND_API_KEY not set, logging instead) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(body);
    if (attachmentFileName) console.log('(Would attach:', attachmentFileName, ')');
    console.log('-----------------------------------------------------');
    return { delivered: false, logged: true };
  }
  const payload = {
    from: process.env.EMAIL_FROM || 'Dream2Fly <no-reply@dream2fly.co.uk>',
    to: [to],
    subject,
    text: body,
    html: wrapEmailHtmlDesignB(subject, body),
  };
  if (attachmentFileName && attachmentBase64) {
    payload.attachments = [{
      filename: attachmentFileName,
      content: attachmentBase64.includes(',') ? attachmentBase64.split(',')[1] : attachmentBase64,
    }];
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }
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

module.exports = { sendMail, isConfigured, renderTemplate, statusEmailTemplates, taskStageTemplates, renderTaskStageTemplate, quickCandidateTemplates, renderQuickCandidateTemplate, wrapEmailHtmlDesignA, wrapEmailHtmlDesignB };
