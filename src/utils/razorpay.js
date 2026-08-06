const crypto = require('crypto');

// Razorpay REST API directly via fetch — no SDK dependency, so nothing
// extra needs installing. Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
// set as environment variables (from the Razorpay dashboard, Settings ->
// API Keys) to actually create live orders. Without them, this logs
// instead of charging anyone — same pattern as email/WhatsApp elsewhere
// in this backend, so nothing breaks before those are configured.

function isConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// Creates a Razorpay Order — the first step before showing the checkout
// popup on the frontend. Amount must be in paise (INR * 100).
async function createRazorpayOrder({ amountInPaise, receipt, notes }) {
  if (!isConfigured()) {
    console.log(`[Razorpay not configured] Would create order for ₹${(amountInPaise / 100).toFixed(2)} — receipt ${receipt}`);
    return { id: 'order_SIMULATED_' + Date.now(), amount: amountInPaise, currency: 'INR', simulated: true };
  }
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountInPaise, currency: 'INR', receipt, notes: notes || {} }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.description || 'Could not create Razorpay order.');
  return data;
}

// Verifies the signature Razorpay's checkout returns after a successful
// payment, confirming it genuinely came from Razorpay and wasn't forged
// client-side. This is the step that actually matters for security —
// never mark a payment as PAID without this passing.
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!isConfigured()) {
    console.log('[Razorpay not configured] Skipping signature verification in simulated mode.');
    return true;
  }
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return expected === razorpaySignature;
}

module.exports = { isConfigured, createRazorpayOrder, verifyPaymentSignature };
