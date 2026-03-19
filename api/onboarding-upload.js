/**
 * File Upload Handler for Onboarding
 *
 * POST /api/onboarding-upload
 * Accepts multipart/form-data with file(s)
 * Stores to Vercel Blob
 * Returns { url, filename, size }
 */

import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, boundary) {
  const files = [];
  const parts = buffer.toString('binary').split('--' + boundary);

  for (const part of parts) {
    if (part.includes('filename="')) {
      const filenameMatch = part.match(/filename="([^"]+)"/);
      const contentTypeMatch = part.match(/Content-Type:\s*(.+)\r\n/);
      const fieldMatch = part.match(/name="([^"]+)"/);

      if (filenameMatch) {
        const headerEnd = part.indexOf('\r\n\r\n') + 4;
        const bodyEnd = part.lastIndexOf('\r\n');
        const body = Buffer.from(part.substring(headerEnd, bodyEnd), 'binary');

        files.push({
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
          field: fieldMatch ? fieldMatch[1] : 'file',
          buffer: body,
        });
      }
    }
  }
  return files;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'multipart/form-data required' });
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) {
    return res.status(400).json({ error: 'No boundary found' });
  }

  try {
    const rawBody = await getRawBody(req);
    const files = parseMultipart(rawBody, boundary);

    if (!files.length) {
      return res.status(400).json({ error: 'No files found' });
    }

    const results = [];

    for (const file of files) {
      const path = `onboarding/sacha-awwa/${Date.now()}-${file.filename}`;

      const blob = await put(path, file.buffer, {
        access: 'public',
        contentType: file.contentType,
      });

      results.push({
        url: blob.url,
        filename: file.filename,
        size: file.buffer.length,
        path,
      });

      console.log(`Uploaded: ${file.filename} (${file.buffer.length} bytes) → ${blob.url}`);
    }

    return res.status(200).json({ ok: true, files: results });
  } catch (e) {
    console.error('Upload failed:', e.message);
    return res.status(500).json({ error: 'Upload failed', message: e.message });
  }
}
