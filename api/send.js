export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'milo-outbound' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing config' });

  const { to, subject, text, html, from, reply_to } = req.body;
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing: to, subject, text/html' });
  }

  const replyTo = reply_to || process.env.DEFAULT_REPLY_TO;
  const sender = from || process.env.DEFAULT_FROM;
  if (!sender) return res.status(500).json({ error: 'Set DEFAULT_FROM env or pass from' });

  const payload = { from: sender, to: [].concat(to), subject };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (replyTo) payload.reply_to = replyTo;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Send failed', details: data });
    return res.status(200).json({ status: 'sent', id: data.id, reply_to: replyTo || sender });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
