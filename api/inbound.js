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

async function createPrivateIssue(inbound, senderKind, intentKind) {
  const ghToken = process.env.GETMILO_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) return { stored: false, reason: 'missing_github_token' };

  const repo = 'getmilodev/milo-private-docs';
  const issueBody = [
    `**Source:** ${inbound.source}`,
    `**Sender kind:** ${senderKind}`,
    `**Intent:** ${intentKind}`,
    `**From:** ${inbound.from || 'unknown'}`,
    `**To:** ${inbound.to || 'unknown'}`,
    inbound.cc ? `**CC:** ${inbound.cc}` : null,
    inbound.replyTo ? `**Reply-To:** ${inbound.replyTo}` : null,
    `**Subject:** ${inbound.subject}`,
    inbound.inboxId ? `**Inbox:** ${inbound.inboxId}` : null,
    inbound.threadId ? `**Thread ID:** ${inbound.threadId}` : null,
    inbound.messageId ? `**Message ID:** ${inbound.messageId}` : null,
    `**Received:** ${inbound.timestamp}`,
    '',
    '---',
    '',
    (inbound.text || inbound.preview || inbound.html || '').toString().substring(0, 12000),
    '',
    '---',
    '<details><summary>Raw payload</summary>',
    '',
    '```json',
    JSON.stringify(inbound.raw, null, 2).substring(0, 18000),
    '```',
    '</details>'
  ].filter(Boolean).join('\n');

  const labels = ['inbound-email', `sender-${senderKind}`, `intent-${intentKind}`];
  const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ghToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify({
      title: `📧 ${intentKind} | ${inbound.subject}`.substring(0, 200),
      body: issueBody,
      labels
    })
  });

  const ghData = await ghRes.json();
  return { stored: ghRes.ok, issue: ghData.number || null, repo, details: ghData };
}

function buildReply(inbound, intentKind) {
  const firstName = (() => {
    const m = String(inbound.from || '').match(/^\s*([^<\s"]+)/);
    return m ? m[1].replace(/[",]/g, '') : 'there';
  })();

  const senderName = firstName && firstName !== inbound.from ? firstName : 'there';
  const bookingLink = 'https://cal.com/getmilodev/30min';

  if (intentKind === 'booking') {
    return {
      subject: inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`,
      text: `Hi ${senderName},\n\nGot your note. The fastest next step is to book an assessment call here: ${bookingLink}\n\nOn that call, Callias will figure out where AI can create the clearest leverage first and whether AI Native is the right next move.\n\n— Callias\nMilo`,
      html: `<p>Hi ${senderName},</p><p>Got your note. The fastest next step is to book an assessment call here: <a href="${bookingLink}">${bookingLink}</a></p><p>On that call, Callias will figure out where AI can create the clearest leverage first and whether AI Native is the right next move.</p><p>— Callias<br>Milo</p>`
    };
  }

  if (intentKind === 'pricing') {
    return {
      subject: inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`,
      text: `Hi ${senderName},\n\nQuick answer: Milo starts with a $500 assessment, then AI Native Setup starts from $2,500 once the right first leverage point is clear.\n\nIf you want, book an assessment call here and we can scope the best next move: ${bookingLink}\n\n— Callias\nMilo`,
      html: `<p>Hi ${senderName},</p><p>Quick answer: Milo starts with a <strong>$500 assessment</strong>, then <strong>AI Native Setup starts from $2,500</strong> once the right first leverage point is clear.</p><p>If you want, book an assessment call here and we can scope the best next move: <a href="${bookingLink}">${bookingLink}</a></p><p>— Callias<br>Milo</p>`
    };
  }

  if (intentKind === 'support') {
    return {
      subject: inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`,
      text: `Hi ${senderName},\n\nGot this. Callias has it in the queue now. If there is a deadline, blocker, or exact failure mode we should know about, reply here with that detail and we will use it.\n\n— Callias\nMilo`,
      html: `<p>Hi ${senderName},</p><p>Got this. Callias has it in the queue now. If there is a deadline, blocker, or exact failure mode we should know about, reply here with that detail and we will use it.</p><p>— Callias<br>Milo</p>`
    };
  }

  if (intentKind === 'security') {
    return {
      subject: inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`,
      text: `Hi ${senderName},\n\nReceived. We will review this with priority. If you want the fastest path, reply with any relevant deadline or risk context and we will handle from there.\n\n— Callias\nMilo`,
      html: `<p>Hi ${senderName},</p><p>Received. We will review this with priority. If you want the fastest path, reply with any relevant deadline or risk context and we will handle from there.</p><p>— Callias<br>Milo</p>`
    };
  }

  return {
    subject: inbound.subject && inbound.subject.toLowerCase().startsWith('re:') ? inbound.subject : `Re: ${inbound.subject}`,
    text: `Hi ${senderName},\n\nGot your note — Callias has it and will review it shortly.\n\nIf there is a concrete deadline or context we should have, just reply to this thread and include it. If the best next move is a call, you can book here: ${bookingLink}\n\n— Callias\nMilo`,
    html: `<p>Hi ${senderName},</p><p>Got your note — Callias has it and will review it shortly.</p><p>If there is a concrete deadline or context we should have, just reply to this thread and include it. If the best next move is a call, you can book here: <a href="${bookingLink}">${bookingLink}</a></p><p>— Callias<br>Milo</p>`
  };
}

async function autonomousReply(inbound, senderKind, intentKind) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'missing_resend_key' };
  if (senderKind !== 'external') return { sent: false, reason: 'not_external' };

  const replyTarget = inbound.replyTo || inbound.from;
  const recipientInbox = (inbound.to || '').split(',')[0].trim() || process.env.DEFAULT_FROM;
  if (!replyTarget || !recipientInbox) return { sent: false, reason: 'missing_addresses' };

  const reply = buildReply(inbound, intentKind);
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
  return { sent: response.ok, id: data.id || null, intent: intentKind, details: data };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'milo-website-inbound' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const inbound = extractInbound(req.body || {});
    if (inbound.skip) {
      return res.status(200).json({ status: 'skipped', type: inbound.eventType, source: inbound.source });
    }

    const senderKind = classifySender(inbound.from);
    const intentKind = classifyIntent(inbound);
    const privateResult = await createPrivateIssue(inbound, senderKind, intentKind);
    const replyResult = await autonomousReply(inbound, senderKind, intentKind);

    console.log('INBOUND:', JSON.stringify({
      source: inbound.source,
      sender_kind: senderKind,
      intent_kind: intentKind,
      from: inbound.from,
      to: inbound.to,
      subject: inbound.subject,
      inboxId: inbound.inboxId,
      threadId: inbound.threadId,
      private_issue: privateResult.issue || null,
      reply_sent: replyResult.sent || false,
      reply_intent: replyResult.intent || null
    }));

    return res.status(200).json({
      status: 'received',
      source: inbound.source,
      sender_kind: senderKind,
      intent_kind: intentKind,
      stored_privately: privateResult.stored,
      private_repo: privateResult.repo || null,
      private_issue: privateResult.issue || null,
      autonomous_reply_sent: replyResult.sent || false
    });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ status: 'error', message: err.message });
  }
}
