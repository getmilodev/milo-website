import crypto from 'crypto';

const pe = (s) => encodeURIComponent(s).replace(/!/g,'%21').replace(/\*/g,'%2A').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29');

function sign(method, url, params, ck, cs, at, as) {
  const op = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const all = { ...op, ...params };
  const ps = Object.keys(all).sort().map(k => pe(k) + '=' + pe(all[k])).join('&');
  const sb = method + '&' + pe(url) + '&' + pe(ps);
  const sk = pe(cs) + '&' + pe(as);
  op.oauth_signature = crypto.createHmac('sha1', sk).update(sb).digest('base64');
  return 'OAuth ' + Object.keys(op).sort().map(k => pe(k) + '="' + pe(op[k]) + '"').join(', ');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (req.headers['x-api-key'] !== process.env.TW_CK) return res.status(401).json({ error: 'unauthorized' });

  const { text } = req.body || {};
  if (!text || text.length > 280) return res.status(400).json({ error: 'text required, max 280 chars' });

  const { TW_CK: ck, TW_CS: cs, TW_AT: at, TW_AS: as } = process.env;
  if (!ck || !cs || !at || !as) return res.status(500).json({ error: 'creds not set' });

  const apiUrl = 'https://api.twitter.com/2/tweets';
  const auth = sign('POST', apiUrl, {}, ck, cs, at, as);

  try {
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
