/**
 * Stripe Webhook Handler — Auto-cancel installment subscriptions
 *
 * Listens for invoice.paid events. When a subscription with
 * metadata.auto_cancel=true reaches metadata.max_payments invoices,
 * cancels the subscription automatically.
 *
 * Endpoint: POST /api/stripe-webhook
 * Stripe webhook signing secret in STRIPE_WEBHOOK_SECRET env var.
 */

export const config = {
  api: {
    bodyParser: false, // Stripe needs raw body for signature verification
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function verifySignature(rawBody, sigHeader, secret) {
  const crypto = require('crypto');
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('='))
  );
  const timestamp = parts.t;
  const signature = parts.v1;

  // Reject if timestamp is older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const STRIPE_SK = process.env.STRIPE_SK;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SK) {
    console.error('Missing STRIPE_SK env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Parse raw body
  const rawBody = await getRawBody(req);
  const bodyStr = rawBody.toString('utf8');

  // Verify webhook signature if secret is configured
  if (WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    if (!sig || !verifySignature(bodyStr, sig, WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(bodyStr);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Only handle invoice.paid events
  if (event.type !== 'invoice.paid') {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    return res.status(200).json({ received: true, action: 'no subscription' });
  }

  // Fetch the subscription to check metadata
  const subRes = await fetch(
    `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
    { headers: { Authorization: `Bearer ${STRIPE_SK}` } }
  );
  const subscription = await subRes.json();
  const meta = subscription.metadata || {};

  if (meta.auto_cancel !== 'true') {
    return res.status(200).json({ received: true, action: 'not auto-cancel' });
  }

  const maxPayments = parseInt(meta.max_payments || '0');
  if (!maxPayments) {
    return res.status(200).json({ received: true, action: 'no max_payments set' });
  }

  // Count paid invoices for this subscription
  const invoicesRes = await fetch(
    `https://api.stripe.com/v1/invoices?subscription=${subscriptionId}&status=paid&limit=100`,
    { headers: { Authorization: `Bearer ${STRIPE_SK}` } }
  );
  const invoices = await invoicesRes.json();
  const paidCount = invoices.data.length;

  console.log(`Subscription ${subscriptionId}: ${paidCount}/${maxPayments} payments (client: ${meta.client}, tier: ${meta.tier})`);

  if (paidCount >= maxPayments) {
    // Cancel the subscription
    const cancelRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${STRIPE_SK}` },
      }
    );
    const canceled = await cancelRes.json();
    console.log(`Auto-canceled subscription ${subscriptionId} after ${paidCount} payments`);
    return res.status(200).json({
      received: true,
      action: 'canceled',
      subscription: subscriptionId,
      payments: paidCount,
      client: meta.client,
    });
  }

  return res.status(200).json({
    received: true,
    action: 'counted',
    payments: paidCount,
    max: maxPayments,
  });
}
