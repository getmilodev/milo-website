const PRIVATE_REPO = 'getmilodev/milo-private-docs';
const AUTO_REPLY_SUPPRESSION_HOURS = 6;
const GITHUB_API = 'https://api.github.com';

function classifySender(address = '') {
  const lower = String(address).toLowerCase();
  const internalDomains = ['getmilo.dev', 'hiremilo.co', 'usemilo.co', 'hellomilo.co', 'agentmail.to'];
  const systemMarkers = ['noreply', 'no-reply', 'mailer-daemon', 'postmaster', 'security-noreply'];
  const domainMatch = lower.match(/@([^>\s]+)/);
  const domain = domainMatch ? domainMatch[1].replace(/[>]/g, '') : '';

  if (internalDomains.includes(domain)) return 'internal';
  if (systemMarkers.some(marker => lower.includes(marker))) return 'system';
  return 'external';
}

function extractInbound(reqBody = {}) {
  if (reqBody.event_type === 'message.received' && reqBody.message) {
    const m = reqBody.message;
    return {
      source: 'agentmail',
      eventType: reqBody.event_type,
      inboxId: m.inbox_id || '',
      threadId: m.thread_id || '',
      messageId: m.message_id || '',
      from: m.from_ || m.from || '',
      to: Array.isArray(m.to) ? m.to.join(', ') : (m.to || ''),
      cc: Array.isArray(m.cc) ? m.cc.join(', ') : (m.cc || ''),
      replyTo: m.reply_to || '',
      subject: m.subject || '(no subject)',
      text: m.text || '',
      html: m.html || '',
      preview: m.preview || '',
      timestamp: reqBody.created_at || new Date().toISOString(),
      raw: reqBody
    };
  }

  const payload = reqBody;
  if (payload.type && payload.type !== 'email.received') {
    return { skip: true, source: 'resend', eventType: payload.type };
  }

  const data = payload.data || payload;
  return {
    source: 'resend',
    eventType: payload.type || 'email.received',
    inboxId: data.to || '',
    threadId: '',
    messageId: data.message_id || '',
    from: data.from || data.sender || '',
    to: Array.isArray(data.to) ? data.to.join(', ') : (data.to || ''),
    cc: Array.isArray(data.cc) ? data.cc.join(', ') : (data.cc || ''),
    replyTo: data.reply_to || '',
    subject: data.subject || '(no subject)',
    text: data.text || data.body || '',
    html: data.html || '',
    preview: data.preview || '',
    timestamp: payload.created_at || new Date().toISOString(),
    raw: payload
  };
}

function classifyIntent(inbound) {
  const haystack = `${inbound.subject || ''}\n${inbound.text || ''}\n${inbound.preview || ''}`.toLowerCase();
  if (/(book|booking|schedule|scheduled|calendar|availability|meet|meeting|call|demo)/.test(haystack)) return 'booking';
  if (/(price|pricing|cost|quote|budget|retainer|how much)/.test(haystack)) return 'pricing';
  if (/(support|help|issue|bug|broken|problem|error|can't|cannot|login|access)/.test(haystack)) return 'support';
  if (/(security|nda|privacy|compliance|confidential)/.test(haystack)) return 'security';
  return 'general';
}

function firstNameFromSender(from = '') {
  const m = String(from).match(/^\s*([^<\s"]+)/);
  return m ? m[1].replace(/[",]/g, '') : 'there';
}

function threadKey(inbound) {
  return inbound.threadId || inbound.messageId || Buffer.from(`${inbound.from}|${inbound.subject}`).toString('base64').slice(0, 32);
}

function hoursSince(isoString) {
  const t = Date.parse(isoString || '');
  if (!t) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60);
}

async function githubRequest(path, options = {}) {
  const ghToken = process.env.GETMILO_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) throw new Error('missing_github_token');
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${ghToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!res.ok) throw new Error(`github_${res.status}:${JSON.stringify(data).slice(0,300)}`);
  return data;
}

async function findOrCreateThreadIssue(inbound, senderKind, intentKind) {
  const key = threadKey(inbound);
  const issues = await githubRequest(`/repos/${PRIVATE_REPO}/issues?state=all&labels=inbound-email&per_page=100`);
  const existing = (issues || []).find(issue => (issue.title || '').includes(`[thread:${key}]`));
  if (existing) return { issue: existing, created: false, key };

  const issueBody = [
    `Thread key: ${key}`,
    `Source: ${inbound.source}`,
    `Sender kind: ${senderKind}`,
    `Intent: ${intentKind}`,
    `From: ${inbound.from || 'unknown'}`,
    `To: ${inbound.to || 'unknown'}`,
    inbound.cc ? `CC: ${inbound.cc}` : null,
    inbound.replyTo ? `Reply-To: ${inbound.replyTo}` : null,
    `Inbox: ${inbound.inboxId || ''}`,
    `Thread ID: ${inbound.threadId || ''}`,
    `Created: ${inbound.timestamp}`,
    '',
    'Private inbound thread state for autonomous handling.'
  ].filter(Boolean).join('\n');

  const created = await githubRequest(`/repos/${PRIVATE_REPO}/issues`, {
    method: 'POST',
    body: {
      title: `📧 [thread:${key}] ${inbound.subject}`.substring(0, 200),
      body: issueBody,
      labels: ['inbound-email', `sender-${senderKind}`, `intent-${intentKind}`]
    }
  });
  return { issue: created, created: true, key };
}

async function addIssueComment(issueNumber, body) {
  return githubRequest(`/repos/${PRIVATE_REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body }
  });
}

async function listIssueComments(issueNumber) {
  return githubRequest(`/repos/${PRIVATE_REPO}/issues/${issueNumber}/comments?per_page=100`);
}

function inboundCommentBody(inbound, senderKind, intentKind) {
  return [
    `## inbound_message`,
    `received_at: ${inbound.timestamp}`,
    `sender_kind: ${senderKind}`,
    `intent_kind: ${intentKind}`,
    `message_id: ${inbound.messageId || ''}`,
    `thread_id: ${inbound.threadId || ''}`,
    `from: ${inbound.from || ''}`,
    `to: ${inbound.to || ''}`,
    '',
    `subject: ${inbound.subject}`,
    '',
    (inbound.text || inbound.preview || inbound.html || '').toString().substring(0, 12000),
    '',
    '<details><summary>raw payload</summary>',
    '',
    '```json',
    JSON.stringify(inbound.raw, null, 2).substring(0, 18000),
    '```',
    '</details>'
  ].join('\n');
}

function extractReplyHistory(comments = []) {
  return comments
    .filter(c => (c.body || '').includes('## auto_reply'))
    .map(c => {
      const body = c.body || '';
      const sentAt = (body.match(/sent_at:\s*(.+)/) || [])[1] || c.created_at;
      const messageId = (body.match(/inbound_message_id:\s*(.+)/) || [])[1] || '';
      const mode = (body.match(/mode:\s*(.+)/) || [])[1] || '';
      return { sentAt: sentAt.trim(), messageId: messageId.trim(), mode: mode.trim(), body };
    });
}

function buildThreadTranscript(issueBody = '', comments = []) {
  const recent = comments.slice(-12).map(c => `COMMENT ${c.created_at}\n${c.body || ''}`).join('\n\n');
  return `${issueBody || ''}\n\n${recent}`.slice(0, 24000);
}

async function generateReplyWithGemini(inbound, senderKind, intentKind, threadTranscript) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are Callias Pulcher, founder of Milo. Write a concise, warm, direct business email reply.

Rules:
- Never mention being an AI.
- Sound like a sharp founder/operator.
- Be useful, not verbose.
- If the email is simple, answer directly.
- If the best next step is a call, suggest the assessment call and include this link exactly: https://cal.com/getmilodev/30min
- If the message is too sensitive, legal, abusive, unclear, or risky to answer automatically, return action HOLD.
- Avoid hype and marketing fluff.

Return strict JSON with keys:
{
  "action": "reply" | "hold",
  "reason": "short string",
  "subject": "string",
  "text": "string",
  "html": "string"
}

Context:
Sender kind: ${senderKind}
Intent kind: ${intentKind}
Inbound from: ${inbound.from}
Inbound subject: ${inbound.subject}
Inbound text: ${(inbound.text || inbound.preview || '').slice(0, 6000)}

Thread transcript:
${threadTranscript}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, responseMimeType: 'application/json' }
    })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    const parsed = JSON.parse(text);
    if (!parsed.subject || !parsed.text) return null;
    return { mode: 'gemini', ...parsed };
  } catch (e) {
    return null;
  }
}

function fallbackReply(inbound, intentKind) {
  const firstName = firstNameFromSender(inbound.from);
  const subject = inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`;
  const bookingLink = 'https://cal.com/getmilodev/30min';
  if (intentKind === 'booking') {
    return {
      mode: 'fallback',
      action: 'reply',
      reason: 'fallback_booking',
      subject,
      text: `Hi ${firstName},\n\nYes — the fastest next step is to book an assessment call here: ${bookingLink}\n\nOn that call, I will figure out where AI can create the clearest leverage first and whether AI Native is the right next move.\n\n— Callias\nMilo`,
      html: `<p>Hi ${firstName},</p><p>Yes — the fastest next step is to book an assessment call here: <a href="${bookingLink}">${bookingLink}</a></p><p>On that call, I will figure out where AI can create the clearest leverage first and whether AI Native is the right next move.</p><p>— Callias<br>Milo</p>`
    };
  }
  if (intentKind === 'pricing') {
    return {
      mode: 'fallback',
      action: 'reply',
      reason: 'fallback_pricing',
      subject,
      text: `Hi ${firstName},\n\nMilo starts with a $500 assessment. AI Native Setup starts from $2,500 once the right first leverage point is clear.\n\nIf useful, book here and we can scope the next move: ${bookingLink}\n\n— Callias\nMilo`,
      html: `<p>Hi ${firstName},</p><p>Milo starts with a <strong>$500 assessment</strong>. AI Native Setup starts from <strong>$2,500</strong> once the right first leverage point is clear.</p><p>If useful, book here and we can scope the next move: <a href="${bookingLink}">${bookingLink}</a></p><p>— Callias<br>Milo</p>`
    };
  }
  if (intentKind === 'support') {
    return {
      mode: 'fallback',
      action: 'reply',
      reason: 'fallback_support',
      subject,
      text: `Hi ${firstName},\n\nGot this. If there is a deadline, blocker, or exact failure mode I should know about, reply here with that detail and I will use it.\n\n— Callias\nMilo`,
      html: `<p>Hi ${firstName},</p><p>Got this. If there is a deadline, blocker, or exact failure mode I should know about, reply here with that detail and I will use it.</p><p>— Callias<br>Milo</p>`
    };
  }
  return {
    mode: 'fallback',
    action: 'reply',
    reason: 'fallback_general',
    subject,
    text: `Hi ${firstName},\n\nGot your note — I saw it. If the best next step is a call, you can book here: ${bookingLink}\n\nIf there is a deadline or context I should have before replying in more detail, send that over.\n\n— Callias\nMilo`,
    html: `<p>Hi ${firstName},</p><p>Got your note — I saw it. If the best next step is a call, you can book here: <a href="${bookingLink}">${bookingLink}</a></p><p>If there is a deadline or context I should have before replying in more detail, send that over.</p><p>— Callias<br>Milo</p>`
  };
}

async function sendReply(inbound, senderKind, reply) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'missing_resend_key' };
  if (senderKind !== 'external') return { sent: false, reason: 'not_external' };

  const replyTarget = inbound.replyTo || inbound.from;
  const recipientInbox = (inbound.to || '').split(',')[0].trim() || process.env.DEFAULT_FROM;
  if (!replyTarget || !recipientInbox) return { sent: false, reason: 'missing_addresses' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: recipientInbox,
      to: [replyTarget],
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
      reply_to: recipientInbox
    })
  });

  const data = await response.json();
  return { sent: response.ok, id: data.id || null, details: data };
}

async function autonomousReply(inbound, senderKind, intentKind, issue, comments) {
  if (senderKind !== 'external') return { sent: false, suppressed: true, reason: 'not_external' };

  const priorReplies = extractReplyHistory(comments);
  if (priorReplies.some(r => r.messageId && r.messageId === inbound.messageId)) {
    return { sent: false, suppressed: true, reason: 'message_already_replied' };
  }

  const recentReply = priorReplies.find(r => hoursSince(r.sentAt) < AUTO_REPLY_SUPPRESSION_HOURS);
  if (recentReply) {
    return { sent: false, suppressed: true, reason: 'thread_recently_replied' };
  }

  const transcript = buildThreadTranscript(issue.body || '', comments);
  const generated = await generateReplyWithGemini(inbound, senderKind, intentKind, transcript);
  const reply = generated && generated.action === 'reply' ? generated : (generated && generated.action === 'hold' ? generated : fallbackReply(inbound, intentKind));

  if (reply.action === 'hold') {
    await addIssueComment(issue.number, [
      '## auto_reply_hold',
      `held_at: ${new Date().toISOString()}`,
      `reason: ${reply.reason || 'model_hold'}`,
      `inbound_message_id: ${inbound.messageId || ''}`
    ].join('\n'));
    return { sent: false, suppressed: false, held: true, reason: reply.reason || 'model_hold', mode: reply.mode || 'gemini' };
  }

  const sendResult = await sendReply(inbound, senderKind, reply);
  if (sendResult.sent) {
    await addIssueComment(issue.number, [
      '## auto_reply',
      `sent_at: ${new Date().toISOString()}`,
      `mode: ${reply.mode || 'fallback'}`,
      `reason: ${reply.reason || ''}`,
      `inbound_message_id: ${inbound.messageId || ''}`,
      '',
      `subject: ${reply.subject}`,
      '',
      reply.text || ''
    ].join('\n'));
  }
  return { ...sendResult, mode: reply.mode || 'fallback', reason: reply.reason || '' };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'milo-website-inbound' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const inbound = extractInbound(req.body || {});
    if (inbound.skip) {
      return res.status(200).json({ status: 'skipped', type: inbound.eventType, source: inbound.source });
    }

    const senderKind = classifySender(inbound.from);
    const intentKind = classifyIntent(inbound);
    const threadState = await findOrCreateThreadIssue(inbound, senderKind, intentKind);
    await addIssueComment(threadState.issue.number, inboundCommentBody(inbound, senderKind, intentKind));
    const comments = await listIssueComments(threadState.issue.number);
    const replyResult = await autonomousReply(inbound, senderKind, intentKind, threadState.issue, comments);

    console.log('INBOUND:', JSON.stringify({
      source: inbound.source,
      sender_kind: senderKind,
      intent_kind: intentKind,
      from: inbound.from,
      to: inbound.to,
      subject: inbound.subject,
      inboxId: inbound.inboxId,
      threadId: inbound.threadId,
      private_issue: threadState.issue.number,
      reply_sent: replyResult.sent || false,
      reply_mode: replyResult.mode || null,
      reply_reason: replyResult.reason || null,
      suppressed: replyResult.suppressed || false,
      held: replyResult.held || false
    }));

    return res.status(200).json({
      status: 'received',
      source: inbound.source,
      sender_kind: senderKind,
      intent_kind: intentKind,
      stored_privately: true,
      private_repo: PRIVATE_REPO,
      private_issue: threadState.issue.number,
      thread_key: threadState.key,
      autonomous_reply_sent: replyResult.sent || false,
      autonomous_reply_mode: replyResult.mode || null,
      reply_suppressed: replyResult.suppressed || false,
      reply_held: replyResult.held || false,
      reply_reason: replyResult.reason || null
    });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ status: 'error', message: err.message });
  }
}
