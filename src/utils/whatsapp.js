// Dream2Fly — WhatsApp sending utility.
//
// IMPORTANT: this is a stub. Actually sending real WhatsApp messages
// requires a WhatsApp Business API account (commonly set up through
// Twilio, or Meta's own Cloud API) — that's a real third-party service
// with its own signup, phone number verification, and cost, which hasn't
// been set up here. Until WHATSAPP_* env vars are configured, this just
// logs the message to the console, exactly like the email utility does
// when SMTP isn't configured — so the rest of the app can be built and
// tested against this interface now, and swapped for a real integration
// later without changing any calling code.

async function sendWhatsApp({ to, message }) {
  if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_TOKEN) {
    console.log('--- WHATSAPP (not configured, logging instead) ---');
    console.log('To:', to);
    console.log(message);
    console.log('----------------------------------------------------');
    return { delivered: false, logged: true };
  }

  // Example shape for a Twilio-style WhatsApp API call — replace with
  // your actual provider's request format once you have real credentials.
  const res = await fetch(process.env.WHATSAPP_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
    },
    body: JSON.stringify({ to, message }),
  });
  if (!res.ok) {
    console.error('WhatsApp send failed:', await res.text());
    return { delivered: false, error: true };
  }
  return { delivered: true };
}

module.exports = { sendWhatsApp };
