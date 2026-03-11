export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'milo-website' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    // Only process email.received events from Resend
    if (payload.type && payload.type !== 'email.received') {
      return res.status(200).json({ status: 'skipped', type: payload.type });
    }

    // Resend nests email data under payload.data
    const data = payload.data || payload;
    const from = data.from || data.sender || 'unknown';
    const to = Array.isArray(data.to) ? data.to.join(', ') : (data.to || 'unknown');
    const subject = data.subject || '(no subject)';
    const text = data.text || data.html || data.body || '';
    const cc = Array.isArray(data.cc) ? data.cc.join(', ') : (data.cc || '');
    const replyTo = data.reply_to || '';
    const ts = payload.created_at || new Date().toISOString();

    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) {
      console.error('No GITHUB_TOKEN configured');
      return res.status(200).json({ status: 'received', stored: false });
    }

    const issueBody = [
      `**From:** ${from}`,
      `**To:** ${to}`,
      cc ? `**CC:** ${cc}` : null,
      replyTo ? `**Reply-To:** ${replyTo}` : null,
      `**Subject:** ${subject}`,
      `**Received:** ${ts}`,
      '',
      '---',
      '',
      typeof text === 'string' ? text.substring(0, 8000) : JSON.stringify(text).substring(0, 8000),
      '',
      '---',
      '<details><summary>Raw payload</summary>',
      '',
      '```json',
      JSON.stringify(payload, null, 2).substring(0, 15000),
      '```',
      '</details>'
    ].filter(line => line !== null).join('\n');

    const ghRes = await fetch('https://api.github.com/repos/getmilodev/milo-website/issues', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        title: `📧 ${from}: ${subject}`.substring(0, 200),
        body: issueBody,
        labels: ['inbound-email']
      })
    });

    const ghData = await ghRes.json();
    console.log('INBOUND:', JSON.stringify({ from, to, subject, ts, issue: ghData.number }));
    return res.status(200).json({ status: 'received', stored: true, issue: ghData.number });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ status: 'error', message: err.message });
  }
}
