// Dream2Fly — WhatsApp sending utility, built for Twilio's real
// Messages API (confirmed against Twilio's own docs): HTTP Basic Auth
// (Account SID as username, Auth Token as password), form-urlencoded
// body — not the generic Bearer+JSON placeholder this file used to be.
//
// Needs three environment variables in Railway:
//   TWILIO_ACCOUNT_SID   — starts with "AC..."
//   TWILIO_AUTH_TOKEN    — from the same Console page, keep this secret
//   TWILIO_WHATSAPP_FROM — the sending number, in the form "whatsapp:+14155238886"
//                          (Twilio's sandbox number, until a real business
//                          sender is approved — then swap in that number)
//
// Until all three are set, this just logs the message to the console,
// exactly like the email utility does when SMTP isn't configured — so
// the rest of the app can be built and tested against this interface,
// and it starts sending for real the moment these are added, with no
// code changes needed anywhere that calls it.
async function sendWhatsApp({ to, message, mediaUrl }) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    console.log('--- WHATSAPP (Twilio not configured, logging instead) ---');
    console.log('To:', to);
    console.log(message);
    if (mediaUrl) console.log('Media:', mediaUrl);
    console.log('-----------------------------------------------------------');
    return { delivered: false, logged: true };
  }

  // Twilio expects both numbers prefixed with "whatsapp:" and in E.164
  // format (+countrycode...). Accepts a bare local-format number here
  // and adds the country code only if one isn't already present, since
  // most numbers stored in this app so far are plain 10-digit Indian
  // numbers without a leading +91.
  const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to.startsWith('+') ? to : '+91' + to.replace(/\D/g, '')}`;

  const params = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: toWhatsApp,
    Body: message,
  });
  if (mediaUrl) params.append('MediaUrl', mediaUrl);

  const basicAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('WhatsApp send failed:', res.status, errBody);
    return { delivered: false, error: true };
  }
  const data = await res.json();
  return { delivered: true, sid: data.sid };
}

module.exports = { sendWhatsApp };
