import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const html = readFileSync(join(process.cwd(), 'receptionist.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(html);
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<h1>Error loading page</h1><p>' + err.message + '</p>');
  }
}
