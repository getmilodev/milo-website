export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  if (!payload || !payload.event) {
    return res.status(400).json({ error: 'Missing event' });
  }

  const eventRecord = {
    received_at: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
    user_agent: req.headers['user-agent'] || '',
    event: payload.event,
    page_path: payload.page_path || '',
    page_title: payload.page_title || '',
    page_url: payload.page_url || '',
    session_id: payload.session_id || '',
    referrer: payload.referrer || '',
    attribution: payload.attribution || {},
    properties: payload.properties || {}
  };

  console.log('[milo-track]', JSON.stringify(eventRecord));

  const webhookUrl = process.env.TRACKING_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventRecord)
      });
    } catch (e) {
      console.error('[milo-track-webhook-error]', e.message);
    }
  }

  return res.status(202).json({ ok: true });
}
