// Wraps a plain-text email body in a branded HTML template — the exact
// same header/footer banner images used on the onboarding documents
// (hosted on the website, not embedded as base64, so emails stay small
// and render reliably across mail clients), with the message in between.
// Plain-text \n\n becomes a new paragraph; single \n becomes a line break.
// Confirmed via direct fetch: the live site resolves at www.dream2fly.co.uk.
// Using the non-www version here would mean every image tag in every
// email points through a redirect — most email clients follow that
// fine, but Gmail's image proxy (it routes external images through its
// own servers, not the recipient's browser) is known to be less
// reliable with redirects, which can quietly show a broken image icon
// instead of the logo even though the same link opens fine in Chrome.
const SITE_BASE_URL = 'https://www.dream2fly.co.uk';

// ---- Design A: full illustrated letterhead (world map, skyline, service icons) ----
function wrapEmailHtmlDesignA(subject, bodyText) {
  const paragraphs = bodyText.split(/\n\n+/).map(block =>
    '<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#333333;">' +
      block.split('\n').map(line => escapeHtml(line)).join('<br>') +
    '</p>'
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
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
<head><meta charset="utf-8"></head>
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

// A dedicated, more visual template specifically for the "Application
// Update Format" — the structured Student's Name / Application Id /
// Country / Institution / Program / Intake / Status layout used to
// mirror how partner agencies like KC Overseas send these. Deep and
// light blue combination, laid out as a real card with field rows
// rather than escaped plain-text paragraphs, since that structured
// data reads much better as a proper table than as sentences.
function wrapApplicationUpdateEmailHtml(subject, fields, commentTitle, commentBody){
  const rows = fields.map(([label, value]) =>
    `<tr>
      <td style="padding:12px 16px; background:#0B1F4D; font-size:11.5px; font-weight:700; color:#ffffff; letter-spacing:0.4px; text-transform:uppercase; border-bottom:2px solid #ffffff; width:38%; vertical-align:middle;">${escapeHtml(label)}</td>
      <td style="padding:12px 16px; background:#eef4ff; font-size:14.5px; font-weight:600; color:#0B1F4D; border-bottom:2px solid #ffffff; vertical-align:middle;">${escapeHtml(value || '—')}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#f4f4f7; font-family:'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7; padding:30px 12px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
        <tr><td style="background:#F6C221; padding:34px 24px 28px; text-align:center;">
          <img src="${SITE_BASE_URL}/images/email/logo-mark.png" width="52" height="45" alt="Dream2Fly" style="display:block; margin:0 auto 10px;">
          <div style="font-size:26px; font-weight:800; color:#0B1F4D; letter-spacing:0.5px;">DREAM<span style="color:#A11D24;">2</span>FLY</div>
          <div style="font-size:11px; font-weight:700; color:#0B1F4D; letter-spacing:2px; margin-top:2px;">CONSULTING SERVICES LIMITED</div>
        </td></tr>
        <tr><td style="background:linear-gradient(135deg, #0B1F4D, #1e4fa8); padding:22px 28px; text-align:center;">
          <div style="font-size:17px; font-weight:700; color:#ffffff;">${escapeHtml(subject)}</div>
        </td></tr>
        <tr><td style="background:#ffffff; padding:24px 24px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px; overflow:hidden; border:2px solid #0B1F4D;">
            ${rows}
          </table>
        </td></tr>
        <tr><td style="background:#ffffff; padding:20px 28px 28px;">
          <div style="background:#eef4ff; border-left:5px solid #0B1F4D; border-radius:6px; padding:16px 18px;">
            <div style="font-size:13px; font-weight:800; color:#0B1F4D; text-transform:uppercase; letter-spacing:0.4px; margin-bottom:6px;">${escapeHtml(commentTitle || 'Comment Received')}</div>
            ${commentBody ? `<div style="font-size:14px; line-height:1.6; color:#26314f;">${escapeHtml(commentBody).replace(/\n/g, '<br>')}</div>` : ''}
          </div>
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

async function sendMail({ to, subject, body, attachmentFileName, attachmentBase64, attachmentMimeType, customHtml }) {
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
    from: process.env.EMAIL_FROM || 'Dream2Fly <noreply-dream2fly@dream2fly.co.uk>',
    to: [to],
    subject,
    text: body,
    html: customHtml || wrapEmailHtmlDesignB(subject, body),
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
  OVERDUE: { subject: 'Action needed on your application', body: 'Hi {{name}},\n\nWe need action from your side to avoid delays.\n\nBest,\nDream2Fly Team' },
  PENDING_PARTNER: { subject: 'Waiting on your referring partner', body: 'Hi {{name}},\n\nWe are currently waiting on your referring partner for the next step. We will update you as soon as we hear back.\n\nBest,\nDream2Fly Team' },
  PENDING_UNIVERSITY: { subject: 'Waiting on the university', body: 'Hi {{name}},\n\nWe are currently waiting to hear back from the university on your application. We will update you as soon as we have news.\n\nBest,\nDream2Fly Team' }
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

// "Case update" notification — sent when something happens on a case
// (a comment posted, status/stage changed) to whoever should know about
// it: the recipient's own name, then the case's key details in a fixed
// block, and a link back to the portal to see the full thread — not the
// comment's actual text, since the point is to prompt them to log in and
// look, not to relay content by email. `recipientName` is whoever this
// particular email is going TO (a sponsor, partner, or staff member —
// not necessarily the student), `title` is the event type shown at the
// bottom of the details block (e.g. "Comment Received", "Status Changed").
function renderCaseUpdateTemplate({ recipientName, task, title, portalLink }) {
  const subject = `Update on ${task.related}'s application — ${title}`;
  const body =
`Hi ${recipientName},
There has been some activity on the application of
Student's Name: ${task.related}
Application Id: ${task.applicationId || '—'}
Country: ${task.country || '—'}
Institution: ${task.college || '—'}
Program: ${task.course || '—'}
Intake: ${task.intake || '—'}
Status: ${task.stage || task.status || '—'}
Title: ${title}

Thank you for the update.

Thanks,
Applications Team

Please do not reply to this email. To view the previous messages or leave a comment, click on:
${portalLink || 'https://dream2fly.co.uk/login.html'}`;
  return { subject, body };
}

// A polished, on-brand template specifically for Promotions — new
// intake announcements, scholarship news, partner recruitment, etc.
// Same visual language as the Application Update template (navy/gold,
// logo header, footer banner), but built for a marketing message: a
// large heading, a body paragraph that can include line breaks, an
// optional image (event banner, offer graphic), and an optional CTA
// button, rather than a data table.
// Renders the body text as HTML, with a twist: any line starting with
// a checkmark or bullet character (✅ ✓ • -) becomes its own colorful
// card with a tinted background and colored left border, cycling
// through the brand palette — this is what gives a promotional email
// real visual energy without relying on CSS animations, which most
// email clients (Gmail, Outlook) strip out entirely for security
// reasons and would just silently fail to render at all.
function renderPromotionBody(bodyText){
  const palette = [
    { bg: '#fff8e6', border: '#F6C221', text: '#8a6400' }, // gold
    { bg: '#eef4ff', border: '#1e4fa8', text: '#0B1F4D' }, // blue
    { bg: '#eafaf0', border: '#1f9d55', text: '#0f6b34' }, // green
    { bg: '#fdeeee', border: '#A11D24', text: '#8a1318' }, // red
  ];
  const lines = bodyText.split('\n');
  let html = '';
  let colorIndex = 0;
  let paragraphBuffer = [];
  const flushParagraph = () => {
    if (paragraphBuffer.length) {
      html += `<div style="font-size:15px; line-height:1.7; color:#26314f; margin-bottom:14px;">${paragraphBuffer.map(escapeHtml).join('<br>')}</div>`;
      paragraphBuffer = [];
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = line.match(/^(✅|✓|•|-)\s*(.+)/);
    if (bulletMatch) {
      flushParagraph();
      const color = palette[colorIndex % palette.length];
      colorIndex++;
      const text = bulletMatch[2];
      // Bold the part before an em-dash or colon, if there is one —
      // e.g. "Zero Processing Fees — our guidance is free" renders
      // with "Zero Processing Fees" as a bold lead-in.
      const splitMatch = text.match(/^([^—:]+)([—:])\s*(.*)$/);
      const inner = splitMatch
        ? `<b style="color:${color.text};">${escapeHtml(splitMatch[1].trim())}</b>${escapeHtml(splitMatch[2])} ${escapeHtml(splitMatch[3])}`
        : escapeHtml(text);
      html += `<div style="background:${color.bg}; border-left:4px solid ${color.border}; border-radius:6px; padding:12px 16px; margin-bottom:10px; font-size:14.5px; line-height:1.6; color:#333333;">✅ ${inner}</div>`;
    } else if (line) {
      paragraphBuffer.push(line);
    } else {
      flushParagraph();
    }
  }
  flushParagraph();
  return html;
}

function wrapPromotionEmailHtml(subject, bodyText, imageUrl, ctaText, ctaUrl){
  const bodyHtml = renderPromotionBody(bodyText);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#f4f4f7; font-family:'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7; padding:30px 12px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
        <tr><td style="background:#F6C221; padding:34px 24px 28px; text-align:center;">
          <img src="${SITE_BASE_URL}/images/email/logo-mark.png" width="52" height="45" alt="Dream2Fly" style="display:block; margin:0 auto 10px;">
          <div style="font-size:26px; font-weight:800; color:#0B1F4D; letter-spacing:0.5px;">DREAM<span style="color:#A11D24;">2</span>FLY</div>
          <div style="font-size:11px; font-weight:700; color:#0B1F4D; letter-spacing:2px; margin-top:2px;">CONSULTING SERVICES LIMITED</div>
        </td></tr>
        ${imageUrl ? `<tr><td style="padding:0;"><img src="${imageUrl}" alt="" style="display:block; width:100%; max-width:600px; height:auto;"></td></tr>` : ''}
        <tr><td style="background:linear-gradient(135deg, #0B1F4D, #1e4fa8); padding:22px 28px; text-align:center;">
          <div style="font-size:19px; font-weight:800; color:#ffffff;">${escapeHtml(subject)}</div>
        </td></tr>
        <tr><td style="background:#ffffff; padding:28px;">
          ${bodyHtml}
          ${ctaText && ctaUrl ? `<div style="text-align:center; margin-top:22px;"><a href="${ctaUrl}" style="display:inline-block; background:linear-gradient(135deg, #A11D24, #d4342c); color:#ffffff; font-weight:700; padding:14px 34px; border-radius:8px; text-decoration:none; font-size:14.5px; box-shadow:0 4px 12px rgba(161,29,36,0.3);">${escapeHtml(ctaText)}</a></div>` : ''}
        </td></tr>
        <tr><td style="background:#f7faff; padding:16px 28px; text-align:center; font-size:12px; color:#8892a6;">
          Hyderabad · Vijayawada · London &nbsp;|&nbsp; info@dream2fly.co.uk &nbsp;|&nbsp; +91 90005 56593
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

module.exports = { sendMail, isConfigured, renderTemplate, statusEmailTemplates, taskStageTemplates, renderTaskStageTemplate, quickCandidateTemplates, renderQuickCandidateTemplate, renderCaseUpdateTemplate, wrapEmailHtmlDesignA, wrapEmailHtmlDesignB, wrapApplicationUpdateEmailHtml, wrapPromotionEmailHtml };
