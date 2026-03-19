/**
 * AI Follow-up Question Generator for Onboarding
 *
 * POST /api/onboarding-followup
 * Input: { capabilities, possibilities, dream, workflows }
 * Output: { "question": "...", "context": "..." }
 *
 * Uses full onboarding context to generate a targeted follow-up question.
 */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const workflows = (body.workflows || '').trim();
  if (!workflows) {
    return res.status(400).json({ error: 'Missing workflows text' });
  }

  // Build rich context from all available fields
  const contextParts = [];
  if (body.capabilities && body.capabilities.length) {
    contextParts.push(`She wants to be able to: ${body.capabilities.join(', ')}`);
  }
  if (body.possibilities && body.possibilities.length) {
    contextParts.push(`She was excited about: ${body.possibilities.join(', ')}`);
  }
  if (body.dream) {
    contextParts.push(`Her dream: "${body.dream}"`);
  }
  const priorContext = contextParts.length
    ? `\n\nContext from earlier in the onboarding:\n${contextParts.join('\n')}`
    : '';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You are helping onboard a marketing consultant named Sacha Awwa. She has a 3P framework (Prepare, Propel, Perfect), is launching a book on June 23, 2026, and runs SAMG Marketing / My Marketer Mentors.

She has described her workflows and you have context from her earlier answers about what she wants and what excites her. Generate ONE specific follow-up question that probes the area where AI could create the most leverage for her. Connect what she said about her workflows to what she said she wants — find the gap.

Be specific to what she said — reference her actual words. Keep the question under 30 words. Return JSON only: { "question": "...", "context": "..." } where context is a 1-sentence explanation of why you're asking this.`,
        messages: [
          {
            role: 'user',
            content: `Here's how Sacha described her work:\n\n"${workflows}"${priorContext}\n\nGenerate one follow-up question. Return JSON only.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', response.status, err);
      return res.status(200).json({
        question: 'Is there anything about your current workflow that feels like it should be easier than it is?',
        context: 'A general follow-up to understand friction points.',
        fallback: true,
      });
    }

    const data = await response.json();
    const text = data.content[0].text;
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    return res.status(200).json({
      question: result.question,
      context: result.context,
      fallback: false,
    });
  } catch (e) {
    console.error('Followup generation failed:', e.message);
    return res.status(200).json({
      question: 'Is there anything about your current workflow that feels like it should be easier than it is?',
      context: 'A general follow-up to understand friction points.',
      fallback: true,
    });
  }
}
