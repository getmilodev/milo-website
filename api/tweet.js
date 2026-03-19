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
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'milo-tweet' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authKey = req.headers['x-api-key'];
  if (authKey !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'unauthorized' });

  const { text } = req.body || {};
  if (!text || text.length > 280) return res.status(400).json({ error: 'text required, max 280 chars' });

  const env = process.env;
  const ck = env.TW_CK, cs = env.TW_CS, at = env.TW_AT, as = env.TW_AS;
  if (!ck || !cs || !at || !as) return res.status(500).json({ error: 'Twitter creds not set' });

  const apiUrl = 'https://api.twitter.com/2/tweets';
  const body = JSON.stringify({ text });
  const auth = sign('POST', apiUrl, {}, ck, cs, at, as);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
      },
      body,
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
