/**
 * Onboarding Form Submission Handler
 *
 * POST /api/onboarding-submit
 * Receives all form data, stores it, and emails Sam a summary.
 *
 * Storage: Vercel KV if configured, otherwise falls back to logging.
 * Email: Resend if configured, otherwise logs the summary.
 */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  if (!body || !body.client) {
    return res.status(400).json({ error: 'Missing client field' });
  }

  const submission = {
    ...body,
    received_at: new Date().toISOString(),
  };

  // --- Storage ---
  let stored = false;

  // Try Vercel KV
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (KV_URL && KV_TOKEN) {
    try {
      const key = `onboarding:${body.client}:${Date.now()}`;
      const kvRes = await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submission),
      });
      if (kvRes.ok) {
        stored = true;
        console.log(`Stored onboarding submission: ${key}`);
      }
    } catch (e) {
      console.error('KV storage failed:', e.message);
    }
  }

  if (!stored) {
    // Fallback: log the full submission so it's in Vercel logs
    console.log('ONBOARDING_SUBMISSION:', JSON.stringify(submission, null, 2));
  }

  // --- Email ---
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'sam@getmilo.dev';

  if (RESEND_API_KEY) {
    try {
      const summary = formatEmailSummary(submission);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Milo <onboarding@getmilo.dev>',
          to: NOTIFICATION_EMAIL,
          subject: `Onboarding complete: ${body.client}`,
          html: summary,
        }),
      });
      console.log(`Email sent to ${NOTIFICATION_EMAIL}`);
    } catch (e) {
      console.error('Email send failed:', e.message);
    }
  }

  return res.status(200).json({ ok: true, stored });
}

function formatEmailSummary(data) {
  const cap = data.capabilities || [];
  const capOther = data.capabilities_other || '';
  const poss = data.possibilities || [];
  const possOther = data.possibilities_other || '';
  const dream = data.dream || '(not provided)';
  const wTime = data.workflow_time || '';
  const wDread = data.workflow_dread || '';
  const wDelegate = data.workflow_delegate || '';
  const workflows = data.workflows || ''; // backwards compat
  const aiQ = data.ai_followup_question || '';
  const aiA = data.ai_followup_answer || '';
  const manuscript = data.manuscript || '(not provided)';
  const brand = data.brand_assets || '(not provided)';
  const tier = data.tier || 'unknown';

  const workflowHtml = (wTime || wDread || wDelegate)
    ? `<p style="font-size: 14px;"><strong>Takes most time:</strong> ${esc(wTime)}</p>
       <p style="font-size: 14px;"><strong>Dreads doing:</strong> ${esc(wDread)}</p>
       <p style="font-size: 14px;"><strong>Wishes someone else handled:</strong> ${esc(wDelegate)}</p>`
    : `<p style="font-size: 14px; white-space: pre-wrap;">${esc(workflows)}</p>`;

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h1 style="font-size: 20px; font-weight: 600; border-bottom: 2px solid #b28e48; padding-bottom: 8px;">
        Onboarding: ${esc(data.client)}
      </h1>
      <p style="color: #666; font-size: 13px;">Tier: ${esc(tier)} | Submitted: ${esc(data.submitted_at || data.received_at)}</p>

      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">What she wants to be able to do</h2>
      <ul style="font-size: 14px;">${cap.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      ${capOther ? `<p style="font-size: 14px;"><strong>Also:</strong> ${esc(capOther)}</p>` : ''}

      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">Possibilities that excited her</h2>
      <ul style="font-size: 14px;">${poss.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      ${possOther ? `<p style="font-size: 14px;"><strong>Also:</strong> ${esc(possOther)}</p>` : ''}

      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">Dream big</h2>
      <p style="font-size: 14px; white-space: pre-wrap;">${esc(dream)}</p>

      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">Current workflows</h2>
      ${workflowHtml}

      ${aiQ ? `
      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">AI follow-up</h2>
      <p style="font-size: 13px; color: #666;"><em>Q: ${esc(aiQ)}</em></p>
      <p style="font-size: 14px; white-space: pre-wrap;">${esc(aiA)}</p>
      ` : ''}

      <h2 style="font-size: 16px; margin-top: 24px; color: #b28e48;">Assets</h2>
      <p style="font-size: 14px;"><strong>Manuscript:</strong> ${esc(manuscript)}</p>
      <p style="font-size: 14px;"><strong>Brand:</strong> ${esc(brand)}</p>
    </div>
  `;
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
