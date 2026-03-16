# Signal-First Prospect Discovery Engine

**Date:** 2026-03-16
**Status:** Design
**Scope:** Both Pathos Labs (executive coaching) and Milo (AI Native Setup)

## Problem

Two businesses need a steady flow of high-quality prospects (.8+ LLM score) who are showing active buying behavior RIGHT NOW. Not cold ICP lists. Not passive company matches. People who are publicly revealing they need what we sell — reachable on LinkedIn.

Current state: the autoresearch pipeline (adapted from Pathos) produced 0 approved leads across 70+ LLM evaluations and thousands of mined comments. The approach of searching by topic keyword and hoping to find buyers in comment noise doesn't work. But hand-raiser posts DO exist — Sam found one for Pathos where commenters on a specific influencer's post were self-identifying as ICP.

## Design Principles (Karpathy Autoresearch)

This system follows the autoresearch philosophy: define a clear objective, give the agent a fixed budget per experiment, let it iterate autonomously, measure everything against a single metric, and evolve.

### 1. Fixed cost budget per cycle

Every cycle spends roughly the same: N Exa queries for post discovery (~$0.01/query) + M Apify comment mines on approved posts (~$0.10-0.50/post depending on comment count) + P Apify profile enrichments on .8+ leads (~$0.004/profile). This makes cycles comparable.

**Default budget:** 20 Exa queries + 3 Apify comment mines + up to 10 profile enrichments = ~$0.60-1.70 per cycle.

### 2. Single metric

**Leads per dollar at .8+ quality.** This is the val_bpb of prospect discovery. The number the mutation engine optimizes. Everything else (post count, comment count, regex hits) is diagnostic — not the objective.

### 3. Single mutation surface

The pipeline code is immutable between cycles. Only the **strategy list** mutates — which Exa queries to run, which posts to mine, which golden sources to check. Like train.py in autoresearch: the infrastructure stays fixed, the experiment parameters evolve.

### 4. Business config as program.md

Each business provides a config file (the equivalent of Karpathy's program.md) that defines ICP criteria, signal families, LLM eval prompt, seed strategies, and known good sources. The engine reads this config and runs autonomously. The human edits the config to steer, not the code.

### 5. Autonomous overnight iteration

Run 50 cycles, wake up to a scoreboard showing which strategies produced leads, which got retired, which new ones the engine generated. The system is crash-safe: state persists after every cycle, resumes on restart.

### 6. Self-contained, minimal dependencies

Three tools: Exa (post discovery), Apify (comment mining + profile enrichment), and `claude -p` (LLM evaluation, OAuth, free). No frameworks, no databases, no build steps.

## Pipeline

### Phase 1: Post Discovery (Exa — cheap)

Exa neural search finds LinkedIn posts whose comment sections are likely to contain ICP prospects. This replaces Apify's expensive post search.

**Validated:** Exa returns LinkedIn post URLs with preview text and author info when queried with `include_domains: ["linkedin.com"]` and `type: "neural"`. It does NOT return engagement counts (comments/likes) — LinkedIn blocks this behind login.

**Input:** Signal strategies from the config — each defines an Exa query targeting a specific type of post by audience/author type.

**Exa query design:** Not topic keywords ("AI tools for business" — returns vendor content). Instead, queries describe the post's AUTHOR and AUDIENCE. Example queries that return real results:
- "agency owner sharing challenges of running a small marketing agency" → returns posts by Collin Slattery, Kristina Radeva, Ian Carroll
- "consultancy owners operate their businesses" → returns Luk Smeyers posts about consulting operations
- "running my own consultancy for 5 years" → returns first-person operator posts

**Output:** Post URLs, author name (from title), content preview (limited — LinkedIn login wall).

**LLM post-filter:** Before spending Apify credits, `claude -p` evaluates each discovered post from preview text + author info: "Based on the author and topic, is this a post where small firm operators are likely commenting about their own experience? Or is this vendor/educational content where comments will be cheerleading?" Only approved posts advance to Phase 2.

**Limitation acknowledged:** Exa cannot tell us comment count. Some approved posts will have few comments and yield nothing. The mutation engine learns which query patterns find engagement-rich posts over time. Budget the 3 post mines per cycle as a portfolio — expect 1-2 to be productive and 1-2 to be duds.

**Golden sources shortcut:** Before running Exa discovery, check golden sources (authors whose posts previously yielded 3+ approved leads) for new posts via Exa query: `"[Author Name] LinkedIn post"` with `include_domains: ["linkedin.com"]`. Cheap ($0.01) but not guaranteed to find recent posts — LinkedIn indexing is imperfect. If golden source check fails, fall back to normal Exa discovery.

### Phase 2: Comment Mining (Apify — expensive, targeted)

Apify's `harvestapi/linkedin-post-comments` scrapes comments on Phase 1 approved posts only.

**Budget per cycle:** Maximum 3 posts mined per cycle. Each post can yield 100-500 comments. This is the expensive step (~$0.10-0.50 per post depending on comment volume).

**Output per comment:** text, commenter name, headline, profile URL, engagement (likes, replies).

### Phase 3: Prospect Evaluation (claude -p — free)

Two-stage filtering: regex pre-filter removes obvious noise, then LLM batch-evaluates survivors.

**Stage 3a: Regex pre-filter (retained from existing pipeline).**
The regex cheaply eliminates:
- Cheerleading ("great post!", "love this!", "nailed it!")
- Vendor self-promotion (detected by headline: "AI agency", "automation consultant")
- Too-short comments (< 40 chars)

Everything else passes to LLM eval. The regex is deliberately loose — it removes ~40-60% of obvious noise to reduce LLM batch size, but does NOT try to detect buying signals. That's the LLM's job.

**Stage 3b: LLM batch evaluation via `claude -p`.**
Batch size: 30 candidates per `claude -p` call. A post with 500 comments, after regex filtering ~250 survive, requires ~8 batch calls. Each call takes 30-60 seconds.

The LLM eval prompt is defined in the business config. For each commenter, it assesses:
- Is this person describing their OWN situation (not giving advice, not selling)?
- Does their headline indicate ICP fit (role, company size, industry)?
- Is there an active signal (pain, frustration, help-seeking, transition)?
- Are they NOT a vendor, competitor, student, or enterprise employee?

**Score threshold:** .8+ to approve. Below .8 = rejected, no further spend.

**Output:** Approved leads with score, buyer type, signal type, reasoning.

### Phase 4: Enrichment (Apify — cheap, only for .8+ leads)

Apify's `harvestapi/linkedin-profile-scraper` fetches the full LinkedIn profile for approved leads only.

**Cost:** ~$0.004 per profile. If a cycle approves 5 leads, enrichment costs $0.02.

**Output:** Full profile data — experience, follower count, activity, connections. This is what powers outreach.

### Deduplication

Two dedup sets maintained in state, checked BEFORE spending resources:
- **`seen_post_urls`**: Post URLs already mined. Prevents re-mining the same post across cycles.
- **`seen_profile_urls`**: Commenter LinkedIn profile URLs already evaluated. Prevents re-evaluating and re-enriching the same person found across different posts or cycles. A prolific commenter who appears on 5 different posts gets evaluated once.

## Signal Strategies

A signal strategy is the fundamental unit the mutation engine evolves. Each strategy defines:

```yaml
- id: "pathos:speaking-coach-audience"
  business: pathos
  source: exa_deep
  objective: "LinkedIn posts by speaking coaches and presentation trainers where executives share their own public speaking fears"
  search_queries:
    - "speaking coach LinkedIn post executives sharing fear"
    - "presentation skills leadership post first person struggle"
    - "public speaking fear professional LinkedIn comments"
  signal_type: hand_raiser

- id: "milo:agency-ops-pain"
  business: milo
  source: exa_deep
  objective: "LinkedIn posts by agency owners or coaches about the operational challenges of running a small agency"
  search_queries:
    - "agency owner sharing challenges running small marketing agency"
    - "hardest part scaling agency operations"
    - "small agency growing pains operations manual"
  signal_type: pain_expression

- id: "milo:make-community-help"
  business: milo
  source: exa_content
  objective: "Posts in Make.com, n8n, or automation forums where small business owners ask for help building AI workflows"
  search_queries:
    - "need help automation workflow small business"
    - "looking for someone build n8n workflow agency"
    - "willing to pay AI automation setup small firm"
  include_domains: ["community.make.com", "community.n8n.io", "reddit.com"]
  signal_type: help_request
```

**Signal types:**
- `hand_raiser` — self-identifying on a relevant post (proven for Pathos)
- `pain_expression` — describing the problem we solve in their own words
- `help_request` — actively asking for help with the thing we sell
- `failed_diy` — tried to solve it themselves, hit a wall
- `hiring_signal` — posting a job for a role our service replaces
- `life_event` — new role, went independent, launched a firm

**Source types:**
- `exa_deep` — Exa neural search on linkedin.com for post discovery → feeds into Apify comment mining
- `exa_content` — Exa neural search on other domains (Reddit, forums, blogs) → the content author IS the prospect (no comment mining needed, but no LinkedIn profile either — enrichment via name search)

## Business Configs

### Pathos Labs Config

```yaml
business: pathos
name: "Pathos Labs — Executive Coaching"

icp:
  summary: "Senior professionals (VP+, founders, directors) in forcing professional moments — new role, went independent, visibility pressure"
  firm_size: null  # individual, not firm-based
  seniority: "VP+, founder, director, partner, consultant with 10+ years"
  industries: ["all professional"]
  anti_patterns: ["coach", "trainer", "consultant selling similar services", "student", "junior", "content creator"]

signal_families:
  - founder_services_pain: "Went independent, struggling with sales/positioning/visibility"
  - institutional_pressure: "VP+ facing board presentations, all-hands, stakeholder visibility"
  - identity_transition: "Career pivots, reinventing professional identity"

eval_prompt: |
  Is this person a REAL BUYER for executive coaching — a senior professional
  currently in a forcing professional moment?

  APPROVE if ALL are true:
  - They describe their OWN current situation (not giving advice, not cheerleading)
  - The situation involves real professional stakes: leadership transition, career pivot,
    visibility pressure, going independent, authority gap
  - Their headline suggests seniority and means: VP+, founder, director, partner,
    senior consultant with real experience (not entry-level, not student)
  - They are NOT a coach, trainer, speaker, or consultant selling similar services

  REJECT if ANY are true:
  - They're giving advice, cheerleading, or speaking retrospectively with no current need
  - Their headline shows they ARE a coach/consultant/trainer in leadership/communication
  - They're a student, junior professional, or content creator farming engagement
  - No forcing moment detected — just general career commentary

golden_sources: []  # populated by engine

seed_strategies:
  - id: "pathos:speaking-fear-audience"
    source: exa_deep
    objective: "LinkedIn posts where professionals discuss public speaking anxiety or presentation fear"
    search_queries:
      - "terrified of speaking on stage professional LinkedIn"
      - "bombed my presentation leadership LinkedIn post"
      - "first time speaking at conference nervous"
    signal_type: hand_raiser
  - id: "pathos:career-transition-stories"
    source: exa_deep
    objective: "LinkedIn posts where people share their experience leaving corporate to go independent"
    search_queries:
      - "left corporate started my own consulting LinkedIn"
      - "went independent hardest part nobody tells you"
      - "career change at 40 starting over professional"
    signal_type: life_event
  - id: "pathos:new-leadership-role"
    source: exa_deep
    objective: "LinkedIn posts about the challenges of a first leadership or executive role"
    search_queries:
      - "promoted to VP everything changed LinkedIn"
      - "first 90 days new leadership role challenges"
      - "nobody told me about being a leader"
    signal_type: hand_raiser
  # ... 10-15 seed strategies total
```

### Milo Config

```yaml
business: milo
name: "Milo — AI Native Setup"

icp:
  summary: "Founders/operators at 3-15 person professional services firms with manual workflows who need AI implementation help"
  firm_size: "3-15 employees"
  seniority: "founder, partner, COO, director of ops, managing partner"
  industries: ["agency", "consulting", "law", "accounting"]
  industry_tiers:
    tier1: ["agency", "consulting"]
    tier2: ["law", "accounting"]
    tier3: ["real estate", "recruiting"]
  anti_patterns: ["AI vendor", "automation agency", "SaaS company", "enterprise 50+", "solo freelancer", "content creator"]

signal_families:
  - workflow_pain: "Manual proposals, reporting, follow-up, research eating their time"
  - ai_frustration: "Tried ChatGPT/Claude, didn't stick, overwhelmed by tools"
  - help_request: "Actively looking for someone to set up AI for their firm"
  - failed_diy: "Built half-finished automations, wasted weeks on setup"
  - hiring_signal: "Posting for AI/automation/operations roles they can't actually fill"

eval_prompt: |
  Is this person a REAL BUYER for AI implementation services — a founder
  or operator at a small professional services firm with active need?

  APPROVE if ALL are true:
  - They describe their OWN current situation (not giving advice, not selling)
  - The situation involves operational frustration, manual workflows, or AI adoption challenges
  - Evidence suggests they run or operate a small professional services firm
    (from headline: agency owner, managing partner, COO, practice founder;
     OR from text: mentions their agency, firm, practice, team size of 3-15)
  - They are NOT an AI vendor, automation agency, SaaS company, or enterprise

  REJECT if ANY are true:
  - Giving generic advice or cheerleading, not describing their own situation
  - They sell AI/automation services (competitor)
  - Large enterprise (50+ employees) or solo freelancer
  - Student, job seeker, or content creator farming engagement
  - Industry far outside professional services (manufacturing, retail, etc.)
  - Not enough context to determine ICP fit (err on rejecting weak signals)

golden_sources: []

seed_strategies:
  - id: "milo:agency-scaling-pain"
    source: exa_deep
    objective: "LinkedIn posts by agency owners about the pain of scaling operations"
    search_queries:
      - "agency owner sharing challenges running small marketing agency"
      - "hardest part of scaling an agency operations"
      - "small agency growing pains wearing every hat"
    signal_type: pain_expression
  - id: "milo:consulting-operations"
    source: exa_deep
    objective: "LinkedIn posts by consulting firm founders about operational challenges"
    search_queries:
      - "running a boutique consulting firm challenges"
      - "consultancy owners operate businesses ad hoc"
      - "consulting firm manual reporting client work"
    signal_type: pain_expression
  - id: "milo:law-firm-ops"
    source: exa_deep
    objective: "LinkedIn posts about small law firm operations and technology challenges"
    search_queries:
      - "small law firm operations challenges technology"
      - "law firm intake process manual slow"
      - "running a small law practice overwhelmed"
    signal_type: pain_expression
  - id: "milo:ai-frustration-smb"
    source: exa_deep
    objective: "LinkedIn posts by small business owners about AI adoption struggles"
    search_queries:
      - "tried ChatGPT for my business didn't stick"
      - "AI tools overwhelming small business owner"
      - "gave up on AI automation small firm"
    signal_type: failed_diy
  - id: "milo:make-n8n-help"
    source: exa_content
    objective: "Forum posts where people ask for help building AI automation workflows"
    search_queries:
      - "need someone build AI automation workflow willing to pay"
      - "looking for help setting up n8n automation small business"
      - "agency workflow automation help Make.com"
    include_domains: ["community.make.com", "community.n8n.io", "reddit.com"]
    signal_type: help_request
  # ... 10-15 seed strategies total
```

## Mutation Engine

Three operations, following the autoresearch philosophy of systematic exploration:

### Promote

Strategies that produced .8+ leads move to the front of the queue. Run first, get more budget.

### Retire

Strategies with 0 leads across 3+ cycles get removed. Retirement triggers generation — the engine never shrinks below a minimum strategy count (15).

### Generate

When strategies retire or when a pattern emerges, `claude -p` generates new strategies.

**Generation prompt receives:**
- The full scoreboard (what worked, what didn't)
- The winning strategies' search_queries and signal_types
- The retired strategies (to avoid regenerating them)
- The business config (ICP, signal families)

**Generation prompt instructs:**
- Propose exactly 5 new strategies as valid YAML
- Each must have: id, source, objective, search_queries (3 variants), signal_type
- Strategies should be similar to winners in structure but explore adjacent audiences/topics
- Strategies must NOT be semantically similar to recently retired ones

**Validation:** Parse the YAML output. Reject any strategy missing required fields. Reject any strategy whose search_queries overlap > 60% with a retired strategy (measured by word overlap). Cap at 5 new strategies per generation event. Maximum strategy pool size: 40.

### Golden Sources Flywheel

When a post author yields 3+ approved leads from a single post, the author is added to `golden-sources.json` with:
- Author name
- Post URL that yielded leads
- Lead count and average score
- Date added

Every cycle begins by querying Exa for recent posts by golden source authors: `"[Author Name]" site:linkedin.com` (one query per source, ~$0.01 each). New posts found are added to the mining queue with priority over Exa discovery results.

Golden sources are checked every cycle but may not yield new posts every time — authors don't post daily. This is expected. The value accrues over weeks as the list grows.

## Outputs

### Per cycle
- `outputs/logs/cycle-NNN-TIMESTAMP.json` — full cycle data (strategies run, posts found, leads)
- `outputs/debug/cycle-NNN-debug.json` — all candidates with regex score + LLM eval reasoning

### Cumulative
- `outputs/scoreboard.md` — strategy performance, channel economics, leads/dollar metric, golden sources
- `outputs/YYYY-MM-DD-leads.md` — daily leads report grouped by business and signal type
- `outputs/golden-sources.json` — curated author list with yield history
- `outputs/autoresearch_state.json` — crash-safe resume state (seen_post_urls, seen_profile_urls, cycle_results, strategies, golden_sources)

### State retention policy

`seen_post_urls` and `seen_profile_urls` are retained indefinitely (prevents re-mining/re-evaluating). `cycle_results` are trimmed to last 20 cycles (older cycles archived to `outputs/logs/`). `all_leads` retained indefinitely (the asset).

### The scoreboard

The scoreboard is the primary human interface. It answers:
- Which strategies are producing leads? (ranked by leads/dollar)
- What's the cost per lead this cycle and overall?
- Which golden sources are active and when last checked?
- What did the mutation engine generate/retire this cycle?
- What's the overall leads/dollar trend across cycles?

## Error Handling

- **Exa API failure:** Log warning, skip strategy, continue cycle. Do not retry — next cycle will re-attempt.
- **Apify API failure:** Log warning, skip post, continue cycle. Post URL stays in queue for next cycle.
- **`claude -p` failure:** Log warning, save raw response to debug file. Skip batch, continue with remaining batches.
- **Rate limits (Exa/Apify):** Exponential backoff with max 3 retries. If still rate-limited, pause cycle for 60 seconds and continue.
- **Crash recovery:** State persisted after every cycle. On restart, load state and continue from next_cycle.

## File Structure

```
ops/autoresearch/
  autoresearch.py          # the engine (immutable between cycles)
  configs/
    pathos.yaml            # Pathos business config (program.md equivalent)
    milo.yaml              # Milo business config
  outputs/
    scoreboard.md
    golden-sources.json
    autoresearch_state.json
    logs/
    debug/
  run.sh                   # sources env, activates venv, runs autoresearch.py with args
  requirements.txt         # exa-py, apify-client, pyyaml
```

## Running

```bash
# Source env and run single business, single cycle
cd ops/autoresearch
export $(grep -v '^#' ~/.config/pathos/secrets.env | xargs)
.venv/bin/python autoresearch.py --config configs/milo.yaml --once

# Or use convenience runner
./run.sh --config configs/milo.yaml --once
./run.sh --config configs/pathos.yaml --bg --cycles 50

# Monitor
tail -f outputs/autoresearch.log
cat outputs/scoreboard.md
```

## Success Criteria

1. At least one cycle produces a .8+ approved lead within the first 10 cycles
2. The mutation engine generates strategies that outperform seed strategies
3. Golden sources list grows to 5+ authors within 50 cycles
4. Cost per .8+ lead is under $1.00
5. System runs autonomously overnight without crashes

## What This Design Does NOT Include

- Outreach drafting (separate skill: /prospect-engage)
- CRM integration (future)
- Reddit API as a direct channel (deprioritized — can't reach people on Reddit, but Exa content search covers Reddit posts)
- Apify post search for discovery (too expensive — Exa replaces this)
- Company-first discovery (deprioritized — we want signals, not cold lists)
