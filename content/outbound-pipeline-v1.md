# Outbound Email Pipeline v1

## Status: READY — Awaiting owner approval to send

**Last updated:** March 9, 2026
**Product lines:** AI Agent Teams · AI for Executives · AI Native Setup

---

## Pipeline Architecture
1. **Apollo.io** — Prospect enrichment and verified emails
2. **Resend** — Verified domain: `join.getmilo.dev` (sending enabled)
3. **Tracking** — Reply monitoring via milo-inbox
4. **CRM** — Stripe customer creation on close

## Decision Needed from Sam
- [ ] Approve test batch (3 emails below)
- [ ] Choose from-name (e.g., "Sam from Milo" vs "Milo Team")
- [ ] Choose from-address format for join.getmilo.dev
- [ ] Approve scaling plan (10/day → 25/day → 50/day over 2 weeks)

---

## Current Product Lines

### 1. AI Agent Teams
- **Price:** $299 starter (1-2 agents) / $2,499 full team (5-6 agents)
- **What:** Autonomous AI agents handling scheduling, follow-ups, outreach, reporting
- **Ongoing cost to customer:** $30-60/mo infrastructure (APIs + hosting)
- **Key sell:** One-time setup. Customer owns everything. No monthly fees to us.
- **Landing page:** getmilo.dev/agents
- **Best for:** Service businesses, professional firms, agencies

### 2. AI for Executives
- **Price:** $2,000-$5,000 depending on complexity
- **What:** Personal AI stack setup + strategic literacy for senior leaders
- **Format:** 1-on-1, confidential, 1-2 weeks
- **Key sell:** Not a course. We wire AI directly into how you work.
- **Landing page:** getmilo.dev/executives
- **Best for:** VPs, directors, C-suite, founders (40s-60s)

### 3. AI Native Setup
- **Price:** $2,500 one-time
- **What:** Go AI-native in one afternoon. Custom Claude workspace built around actual workflows.
- **Key sell:** Tailored to your role. Walk away as the most dangerous person in your office.
- **Landing page:** getmilo.dev/ainative
- **Best for:** COOs, operations directors at professional services firms

---

## Test Batch: 3 Prospects (one per product line)

### Prospect 1: Small Business Owner → AI Agent Teams
- **Target profile:** Owner of 5-20 person service business (legal, real estate, insurance, trades)
- **Source:** Apollo.io search or Reddit engagement
- **Pain point:** Missed leads, manual follow-ups, no-show appointments

### Prospect 2: COO at Professional Services Firm → AI Native Setup
- **Target profile:** COO or VP Operations at 20-200 person CPA/law/advisory firm
- **Source:** LinkedIn + Apollo enrichment
- **Pain point:** Operational inefficiency, admin overhead, team scaling challenges
- **Note:** Wave 3 prospect list (content/ainative-wave3-prospects.md) has 7 researched prospects ready

### Prospect 3: Senior Executive → AI for Executives
- **Target profile:** VP/Director/C-suite, 40s-60s, at mid-size company
- **Source:** LinkedIn + Apollo enrichment
- **Pain point:** Knows AI matters, hasn't found a way in that respects their intelligence and time

---

## Email Template A: Service Business Owner → AI Agent Teams

**Subject:** The follow-ups {company} never gets to

**Body:**

{first_name} —

Quick question: how many leads contacted {company} last month that never got a follow-up?

For most {business_type} businesses your size, it's 30-40%. Not because you don't care — because you're running jobs, managing a team, and doing the actual work. Follow-ups fall off.

We build AI agent teams that handle it — follow-ups, scheduling, lead capture, daily reporting. Not a chatbot. Actual agents that coordinate with each other, running 24/7.

One-time setup ($299-$2,499 depending on team size). You own everything. Your only ongoing cost is $30-60/month in hosting and API fees. No subscription to us, ever.

We run 12 of these agents in our own business. Same system we deploy for clients.

Would a 15-minute walkthrough of how this works for {business_type} be useful? Reply to this email and I'll set it up.

{sender_name}
Milo — getmilo.dev/agents

---

## Email Template B: COO/VP Ops → AI Native Setup

**Subject:** {first_name}, quick question about {company}'s operations

**Body:**

{first_name} —

{personalization_hook}

We build AI agent teams for firms like {company} — not chatbots, but autonomous agents that handle scheduling, follow-ups, client communication, and daily reporting. One-time $2,500 setup, runs on your infrastructure, $30-60/month to operate.

The system running our own business (12 agents, 6 months in production) is the same one we deploy for clients. Everything is yours — no vendor lock-in, no monthly fees to us.

Worth a 15-minute look?

{sender_name}
Milo — getmilo.dev/ainative

---

## Email Template C: Senior Executive → AI for Executives

**Subject:** The AI gap nobody's solving for people at your level

**Body:**

{first_name} —

Here's something I keep seeing: senior operators with 20+ years of experience getting outproduced by juniors with Claude and a few automations. Not because the juniors are better — because AI multiplies whatever you feed it.

The problem is, nobody's teaching this properly for people at your level. It's all YouTube tutorials and LinkedIn influencers. None of it respects your time or your workflow.

We do 1-on-1 AI enablement for executives. We sit down with you, understand how you actually work, and wire AI directly into your daily operating system. Not a course. Not theory. Your real emails, real reports, real decisions — transformed.

$2,000-$5,000 depending on complexity. 1-2 weeks. Confidential. You walk away AI-capable, not AI-curious.

If your time is worth $200+/hour, this pays for itself in the first week. Most executives report saving 5-10 hours per week once their stack is dialed in.

Worth a conversation? Reply and I'll send you a few times for a confidential 30-minute intro.

{sender_name}
Milo — getmilo.dev/executives

---

## Scaling Plan

### Week 1: Test (3 emails)
- Send 1 email per product line to the 3 prospects above
- Monitor: deliverability, open rates, replies
- Iterate on subject lines and copy based on results

### Week 2: Small batch (10/day)
- Enrich 50 more prospects (mix across all 3 product lines)
- A/B test 2 subject line variants per template
- Monitor bounce rate, spam complaints

### Week 3: Scale (25/day)
- If Week 2 shows <2% bounce rate and >20% open rate, increase volume
- Add industry-specific variants (legal, CPA, real estate, insurance)
- Begin segmenting by company size and seniority

### Week 4: Full pipeline (50/day)
- 3-email sequence: initial outreach, follow-up (day 3), last chance (day 7)
- Target: 1,000 prospects/month, 2-3% reply rate = 20-30 conversations

## Revenue Targets
- Agent Teams ($299-$2,499): 2 customers/month = $600-$5,000/month
- AI Native ($2,500): 1 customer/month = $2,500/month
- Executives ($2,000-$5,000): 1 customer/month = $2,000-$5,000/month
- **Combined target: $5,000-$12,500/month by Month 3**

## Expected Outcomes
- **Test batch (3):** Validate deliverability and message-market fit
- **Month 1 (500 emails):** 10-15 replies, 3-5 demos, 1-2 customers
- **Month 2+ (1,000/month):** 20-30 replies, 6-10 demos, 2-4 customers/month

## Cost
- Apollo.io: Free tier (sufficient for this volume)
- Resend: Free tier (3,000 emails/month)
- Total additional monthly cost: $0
