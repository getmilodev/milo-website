# Milo Autoresearch — Prospect Discovery Loop

Autonomous prospect discovery for getmilo.dev. Adapted from the Pathos Labs
autoresearch architecture.

## Quick Start

```bash
cd ops/autoresearch
./run.sh --once              # single cycle
./run.sh --cycles 10         # 10 cycles
./run.sh --bg --cycles 50    # background, 50 cycles
./run.sh --exa-only --once   # Exa only (no Apify credits)
```

## Architecture

```
LinkedIn post search → Comment mining → Regex pre-filter → claude -p batch eval → Leads
         ↓                                                            ↓
    Apify credits                                              Mutation engine
         ↓                                                     (promote/retire)
    Strategy pool ←───────────────────────────────────────────────────┘
```

**Signal chain:** Search posts by query → mine comments on high-engagement posts →
regex filters obvious noise (cheerleading, vendors, too-short) → `claude -p`
(OAuth, free) evaluates if commenter is ICP → mutation promotes strategies that
produce leads, retires dead ones.

## Key Findings (2026-03-15)

1. **Fish where operators gather, not where AI vendors gather.** Posts about
   "AI tools for small business" attract vendors and tech people. Posts about
   "running an agency" or "proposal writing burnout" attract the actual ICP.

2. **The regex should be loose.** Only filter out obvious noise. Let the LLM do
   the real quality judgment — it's very accurate at identifying ICP vs non-ICP.

3. **Exa is for discovery, not lead-gen.** Exa returns article/blog content where
   buyers are the readers, not the authors. LinkedIn comments reveal individual
   buyers with profile metadata (headline, profile URL).

## API Keys

- `~/.config/pathos/secrets.env` (APIFY_API_TOKEN, EXA_API_KEY)
- LLM eval uses `claude -p` (OAuth, no API key needed)

## Outputs

- `outputs/scoreboard.md` — strategy performance, channel economics
- `outputs/YYYY-MM-DD-leads.md` — daily leads report
- `outputs/debug/cycle-NNN-debug.json` — regex hits + LLM evaluations
- `outputs/logs/` — full cycle data
- `outputs/autoresearch_state.json` — crash-safe resume state
