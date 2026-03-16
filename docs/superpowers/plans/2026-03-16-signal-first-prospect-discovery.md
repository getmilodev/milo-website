# Signal-First Prospect Discovery Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the V1 autoresearch pipeline into a signal-first prospect discovery engine that uses Exa for cheap post discovery, Apify for targeted comment mining on engagement-verified posts, and `claude -p` for free LLM evaluation — producing .8+ quality leads for both Pathos Labs and Milo.

**Architecture:** Single Python script (`ops/autoresearch/autoresearch.py`) reads a business-specific YAML config, runs an autonomous cycle loop (Exa post discovery → Apify engagement check → Apify comment mining → regex pre-filter → LLM eval → Apify enrichment), mutates its strategy list (promote/retire/generate), and persists state after every cycle. Desktop notification via `notify-send` on .8+ leads.

**Tech Stack:** Python 3.14, exa-py, apify-client, pyyaml, `claude -p` (OAuth headless)

**Spec:** `docs/superpowers/specs/2026-03-16-signal-first-prospect-discovery-design.md`

---

## File Structure

```
ops/autoresearch/
  autoresearch.py          # MODIFY: the engine (refactor from V1)
  configs/
    milo.yaml              # CREATE: Milo business config
    pathos.yaml            # CREATE: Pathos business config
  run.sh                   # MODIFY: add --config and --dry-run flags
  requirements.txt         # EXISTS: no changes needed
  outputs/                 # EXISTS: runtime outputs (gitignored)
```

The engine stays as a single file. YAML configs are the new abstraction. No new Python modules.

---

## Chunk 1: Config Loading + CLI Changes

### Task 1: Create YAML config files

**Files:**
- Create: `ops/autoresearch/configs/milo.yaml`
- Create: `ops/autoresearch/configs/pathos.yaml`

- [ ] **Step 1: Create configs directory**

```bash
mkdir -p ops/autoresearch/configs
```

- [ ] **Step 2: Write milo.yaml**

Create `ops/autoresearch/configs/milo.yaml` with the full Milo config from the spec: business name, ICP summary, product description, signal families, eval prompt (with anti-injection preamble), and **10-15 seed strategies** (all `exa_deep`) covering: agency-scaling-pain, consulting-operations, law-firm-ops, accounting-practice-ops, ai-frustration-smb, agency-owner-burnout, consulting-partner-workload, proposal-writing-pain, client-reporting-pain, follow-up-broken, agency-coach-audience, small-firm-admin-overwhelm. Each strategy needs: id, source (`exa_deep`), objective, search_queries (3 variants), signal_type. Include empty `golden_sources: []`. The spec examples are a starting point — generate the full set following the same pattern.

- [ ] **Step 3: Write pathos.yaml**

Create `ops/autoresearch/configs/pathos.yaml` with the full Pathos config from the spec: business name, ICP summary, product description, signal families (founder_services_pain, institutional_pressure, identity_transition), eval prompt (with anti-injection preamble), and **10-15 seed strategies** (all `exa_deep`) covering: speaking-fear-audience, career-transition-stories, new-leadership-role, went-independent-pain, founder-sales-struggle, imposter-syndrome-leaders, first-90-days-executive, board-presentation-fear, career-pivot-40s, authority-gap-new-role, leadership-coach-audience, executive-vulnerability-posts. Include empty `golden_sources: []`.

- [ ] **Step 4: Commit**

```bash
git add ops/autoresearch/configs/
git commit -m "feat(autoresearch): add milo and pathos YAML configs"
```

### Task 2: Add config loading + validation to autoresearch.py

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Add `load_config()` function**

Replace the hardcoded `BUSINESS`, `ICP_SUMMARY`, `PRODUCT`, `LINKEDIN_QUERIES`, `EXA_QUERIES` constants at the top of autoresearch.py with a `load_config(path: str) -> dict` function that:
1. Reads the YAML file
2. Validates required fields: `business`, `name`, `icp` (with `summary`), `eval_prompt`, `seed_strategies`
3. Returns the parsed config dict
4. On missing fields: logs a human-readable error listing which fields are missing, then `sys.exit(1)`
5. On YAML parse error: logs the error with file path, then `sys.exit(1)`

```python
import yaml

REQUIRED_CONFIG_FIELDS = ["business", "name", "icp", "eval_prompt", "seed_strategies"]
REQUIRED_ICP_FIELDS = ["summary"]

def load_config(config_path: str) -> dict:
    """Load and validate a business config YAML file."""
    path = Path(config_path)
    if not path.exists():
        logger.error("Config file not found: %s", path)
        sys.exit(1)
    try:
        config = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        logger.error("Invalid YAML in %s: %s", path, exc)
        sys.exit(1)
    missing = [f for f in REQUIRED_CONFIG_FIELDS if f not in config]
    if missing:
        logger.error("Config %s missing required fields: %s", path, ", ".join(missing))
        sys.exit(1)
    icp = config.get("icp", {})
    missing_icp = [f for f in REQUIRED_ICP_FIELDS if f not in icp]
    if missing_icp:
        logger.error("Config %s icp section missing: %s", path, ", ".join(missing_icp))
        sys.exit(1)
    if not config.get("seed_strategies"):
        logger.error("Config %s has no seed_strategies", path)
        sys.exit(1)
    return config
```

- [ ] **Step 2: Update CLI args**

In `main()`, add new flags alongside old ones (don't remove old ones yet — keeps the module runnable until Task 5 completes):
```python
parser.add_argument("--config", help="Path to business config YAML (new pipeline)")
parser.add_argument("--dry-run", action="store_true", help="Exa discovery + engagement check only, no comment mining")
```

Keep `--once`, `--cycles`, `--output`, `--sleep`, `-v`, `--linkedin-only`, `--exa-only` for now.

- [ ] **Step 3: Add config loading to main() (additive only)**

At the top of `main()`, after parsing args, add an early branch:
```python
if args.config:
    config = load_config(args.config)
    logger.info("Loaded config: %s (%d strategies)", config["name"], len(config["seed_strategies"]))
    # New pipeline will be wired in Task 5 — for now just validate config loads
else:
    config = None
    # Fall through to old V1 pipeline (preserved until Task 5)
```

**Do NOT remove** the hardcoded constants, `build_strategies()`, or old pipeline code yet. That happens in Task 10 (cleanup) after the new pipeline is working. This keeps the module functional between commits.

- [ ] **Step 5: Verify import + load works**

```bash
cd ops/autoresearch
.venv/bin/python -c "
import autoresearch as ar
config = ar.load_config('configs/milo.yaml')
print(f'Business: {config[\"name\"]}')
print(f'Strategies: {len(config[\"seed_strategies\"])}')
print(f'Eval prompt: {config[\"eval_prompt\"][:60]}...')
"
```

Expected: prints Milo business name, strategy count, eval prompt preview.

- [ ] **Step 6: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): replace hardcoded constants with YAML config loading"
```

---

## Chunk 2: Exa Post Discovery + Engagement Check

### Task 3: Replace Apify post search with Exa post discovery

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Rewrite `exa_search()` for LinkedIn post discovery**

Replace the existing `exa_search()` and `exa_search_category()` functions with a single `exa_discover_posts()` function:

```python
def exa_discover_posts(api_key: str, strategy: dict, seen_post_urls: set[str]) -> list[dict]:
    """Use Exa neural search to find LinkedIn posts for a signal strategy.

    Returns list of {url, author, title, preview, strategy_id}.
    """
    try:
        from exa_py import Exa
    except ImportError:
        logger.warning("exa_py not installed")
        return []

    exa = Exa(api_key=api_key)
    posts = []

    for query in strategy.get("search_queries", []):
        try:
            result = exa.search(
                query,
                type="neural",
                num_results=10,
                contents={"text": {"max_characters": 300}},
                include_domains=["linkedin.com"],
            )
            for r in result.results:
                url = r.url or ""
                if not url or url in seen_post_urls:
                    continue
                posts.append({
                    "url": url,
                    "author": r.title or "",
                    "preview": (r.text or "")[:300],
                    "strategy_id": strategy["id"],
                    "query": query,
                })
        except Exception as exc:
            logger.warning("Exa search failed for %r: %s", query[:40], exc)

    logger.info("Exa strategy %s: %d queries → %d new posts",
                strategy["id"][:40], len(strategy.get("search_queries", [])), len(posts))
    return posts
```

- [ ] **Step 2: Add golden source check function**

```python
def exa_check_golden_sources(api_key: str, golden_sources: list[dict], seen_post_urls: set[str]) -> list[dict]:
    """Check golden source authors for new posts via Exa."""
    try:
        from exa_py import Exa
    except ImportError:
        return []

    exa = Exa(api_key=api_key)
    posts = []

    for source in golden_sources:
        author_name = source.get("author", "")
        if not author_name:
            continue
        try:
            result = exa.search(
                f'"{author_name}" site:linkedin.com',
                type="neural",
                num_results=5,
                contents={"text": {"max_characters": 300}},
                include_domains=["linkedin.com"],
            )
            for r in result.results:
                url = r.url or ""
                if not url or url in seen_post_urls:
                    continue
                posts.append({
                    "url": url,
                    "author": author_name,
                    "preview": (r.text or "")[:300],
                    "strategy_id": f"golden:{author_name[:30]}",
                    "query": f"golden source: {author_name}",
                    "is_golden": True,
                })
            new_from_this_author = sum(1 for r2 in result.results if r2.url and r2.url not in seen_post_urls)
            logger.info("Golden source %s: %d new posts", author_name[:30], new_from_this_author)
        except Exception as exc:
            logger.warning("Golden source check failed for %s: %s", author_name[:30], exc)

    return posts
```

- [ ] **Step 3: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): add Exa post discovery + golden source check"
```

### Task 4: Add Apify engagement verification (Phase 1.5)

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Add `apify_check_engagement()` function**

```python
def apify_check_engagement(client, post_url: str) -> int | None:
    """Check a LinkedIn post's comment count via Apify. Returns comment count or None on failure."""
    try:
        run = client.actor("harvestapi/linkedin-post-search").call(run_input={
            "searchQueries": [post_url],
            "maxPosts": 1,
            "sortBy": "relevance",
        })
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        if items:
            eng = items[0].get("engagement") or {}
            return eng.get("comments", 0) or 0
    except Exception as exc:
        err_msg = str(exc)
        if "usage hard limit" in err_msg.lower() or "billing" in err_msg.lower():
            raise  # Propagate billing errors — caller must abort cycle
        logger.warning("Engagement check failed for %s: %s", post_url[:60], exc)
    return None
```

- [ ] **Step 2: Add `filter_by_engagement()` that checks a batch of posts**

```python
MIN_COMMENTS_FOR_MINING = 15
MAX_ENGAGEMENT_CHECKS_PER_CYCLE = 10

def filter_by_engagement(client, posts: list[dict], seen_post_urls: set[str]) -> list[dict]:
    """Filter posts to those with 15+ comments. Returns filtered list sorted by comment count."""
    qualified = []
    for post in posts[:MAX_ENGAGEMENT_CHECKS_PER_CYCLE]:
        url = post["url"]
        if url in seen_post_urls:
            continue
        comment_count = apify_check_engagement(client, url)
        if comment_count is None:
            logger.info("  Engagement check failed for %s — skipping", url[:60])
            continue
        if comment_count < MIN_COMMENTS_FOR_MINING:
            logger.info("  %s: %d comments (below %d threshold) — skipping",
                        post["author"][:30], comment_count, MIN_COMMENTS_FOR_MINING)
            continue
        post["comments"] = comment_count
        qualified.append(post)
        logger.info("  %s: %d comments — QUALIFIED for mining", post["author"][:30], comment_count)

    qualified.sort(key=lambda p: p.get("comments", 0), reverse=True)
    return qualified
```

- [ ] **Step 3: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): add Apify engagement verification (Phase 1.5)"
```

---

## Chunk 3: Rewrite run_cycle() + LLM Eval

### Task 5: Rewrite `run_cycle()` for the new pipeline

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Add helper for empty cycle results + rewrite `run_cycle()` signature**

Add a helper used when cycles abort early (dry-run, billing limit, no qualified posts):

```python
def _empty_cycle_result(cycle_num: int, cycle_start: float, strategy_stats: dict) -> dict:
    return {
        "cycle": cycle_num,
        "timestamp": datetime.now(UTC).isoformat(),
        "elapsed_seconds": round(time.time() - cycle_start, 1),
        "strategies_run": len(strategy_stats),
        "posts_discovered": 0,
        "posts_qualified": 0,
        "posts_mined": 0,
        "total_candidates": 0,
        "regex_hits": 0,
        "leads_found": 0,
        "leads": [],
        "strategy_stats": strategy_stats,
        "cost_exa": 0,
        "cost_apify": 0,
    }
```

Replace the existing `run_cycle()` with the new pipeline. The function signature becomes:

```python
MAX_POSTS_TO_MINE = 3

def run_cycle(
    config: dict,
    apify_client,
    exa_key: str,
    strategies: list[dict],
    golden_sources: list[dict],
    seen_post_urls: set[str],
    seen_profile_urls: set[str],
    cycle_num: int,
    dry_run: bool = False,
) -> dict:
```

Phase 1 body: iterate over strategies, call `exa_discover_posts()` for each, collect all discovered posts. Prepend golden source posts (from `exa_check_golden_sources()`). Dedupe against `seen_post_urls`.

- [ ] **Step 2: Add Phase 1.5 (engagement check) to run_cycle**

After Phase 1 collects candidate posts, call `filter_by_engagement()` to verify comment counts. If `dry_run=True`, log the results and return early (no Phase 2+).

```python
    # Phase 1.5: Engagement verification
    logger.info("Phase 1.5: Checking engagement on %d candidate posts...", len(all_posts))
    try:
        qualified_posts = filter_by_engagement(apify_client, all_posts, seen_post_urls)
    except Exception as exc:
        if "usage hard limit" in str(exc).lower():
            logger.error("Apify billing limit reached — aborting cycle")
            return _empty_cycle_result(cycle_num, cycle_start, strategy_stats)
        raise

    if dry_run:
        logger.info("DRY RUN: Would mine %d posts. Stopping.", len(qualified_posts))
        # ... return cycle result with post info but no leads
```

- [ ] **Step 3: Add Phase 2 (comment mining) to run_cycle**

For the top `MAX_POSTS_TO_MINE` qualified posts, call the existing `linkedin_mine_comments()`. For each comment returned, attach the post metadata:

```python
for post in qualified_posts[:MAX_POSTS_TO_MINE]:
    seen_post_urls.add(post["url"])
    comments = linkedin_mine_comments(apify_client, post["url"])
    for c in comments:
        # Map post discovery shape to comment mining shape
        c["_source_post"] = post["url"]
        c["_source_author"] = post["author"]  # from exa_discover_posts() "author" field
        c["_strategy"] = post["strategy_id"]  # from exa_discover_posts() "strategy_id" field
        # Dedup: skip commenters we've already evaluated
        profile = c.get("profile_url", "")
        if profile and profile in seen_profile_urls:
            continue
        if profile:
            seen_profile_urls.add(profile)
        candidates.append(c)
```

The `linkedin_mine_comments()` returns dicts with keys: `text`, `name`, `headline`, `profile_url`, `comment_url`, `likes`, `replies`, `source_url`, `channel`. The metadata keys `_source_post`, `_source_author`, `_strategy` are added here to connect each comment to its discovery context for golden source tracking.

- [ ] **Step 4: Add Phase 3 (regex + LLM eval) to run_cycle**

Reuse the existing regex pre-filter code as-is (the `score_comment_regex()` function and all regex patterns stay unchanged).

Update `llm_evaluate_batch()` signature to:
```python
def llm_evaluate_batch(candidates: list[dict], config: dict) -> list[dict]:
```

The prompt composition works in three parts — the config's eval_prompt provides the CRITERIA section, and the function wraps it with the batch format:

```python
    # Part 1: Context from config
    preamble = (
        f"You evaluate prospects for {config['name']}.\n"
        f"ICP: {config['icp']['summary']}\n\n"
    )

    # Part 2: Criteria from config's eval_prompt (contains APPROVE/REJECT rules + anti-injection)
    criteria = config["eval_prompt"]

    # Part 3: Batch entries + JSON output format (always the same)
    entries_text = "\n\n".join(entries)  # built from candidates as before
    output_format = (
        "\n\nPROSPECTS TO EVALUATE:\n\n"
        + entries_text
        + "\n\nRespond with a JSON array. For each entry:\n"
        '{"index": N, "approved": bool, "score": 0.0-1.0, '
        '"buyer_type": str, "reasoning": "one sentence"}\n'
        "JSON array only, no other text:"
    )

    prompt = preamble + criteria + output_format
```

The entry building code (iterating candidates to produce `[i] CHANNEL: ... HEADLINE: ... TEXT: ...`) stays the same as V1.

- [ ] **Step 5: Add Phase 4 (enrichment) stub**

After LLM eval, for each .8+ approved lead, call Apify profile scraper. For V1, this can be a simple function:

```python
def apify_enrich_profile(client, profile_url: str) -> dict:
    """Fetch full LinkedIn profile for an approved lead."""
    try:
        run = client.actor("harvestapi/linkedin-profile-scraper").call(run_input={
            "queries": [profile_url],
        })
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        if items:
            return items[0]
    except Exception as exc:
        logger.warning("Profile enrichment failed for %s: %s", profile_url[:60], exc)
    return {}
```

Add `seen_profile_urls` tracking for all evaluated commenters (not just approved ones — prevents re-evaluating the same person).

- [ ] **Step 6: Add notify-send on .8+ leads**

```python
def notify_leads(count: int, cycle_num: int):
    """Fire desktop notification when leads are found."""
    if count > 0:
        try:
            subprocess.run(
                ["notify-send", "Autoresearch", f"{count} new lead{'s' if count != 1 else ''} found (cycle {cycle_num})"],
                timeout=5,
            )
        except Exception:
            pass  # Notification is best-effort
```

Call at end of cycle when `leads_found > 0`.

- [ ] **Step 7: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): rewrite run_cycle for Exa→engagement→mine→eval pipeline"
```

---

## Chunk 4: Mutation Engine + Golden Sources

### Task 6: Add generate operation to mutation engine

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Add `generate_strategies()` function**

```python
MIN_STRATEGY_COUNT = 15
MAX_STRATEGY_COUNT = 40
MAX_GENERATE_PER_EVENT = 5

def generate_strategies(
    config: dict,
    scoreboard_text: str,
    winning_strategies: list[dict],
    retired_strategies: list[dict],
) -> list[dict]:
    """Use claude -p to generate new signal strategies based on what worked."""
    if not winning_strategies and not retired_strategies:
        return []

    winners_yaml = yaml.dump(winning_strategies[:5], default_flow_style=False) if winning_strategies else "None yet"
    retired_yaml = yaml.dump(retired_strategies[:10], default_flow_style=False) if retired_strategies else "None"

    prompt = (
        f"You generate signal strategies for {config['name']}.\n"
        f"ICP: {config['icp']['summary']}\n\n"
        f"WINNING STRATEGIES (keep exploring similar):\n{winners_yaml}\n\n"
        f"RETIRED STRATEGIES (avoid these patterns):\n{retired_yaml}\n\n"
        f"SCOREBOARD:\n{scoreboard_text[:2000]}\n\n"
        "Generate exactly 5 new strategies as a YAML list. Each must have:\n"
        "- id: unique string like 'milo:new-description' or 'pathos:new-description'\n"
        "- source: exa_deep\n"
        "- objective: one sentence describing what LinkedIn posts to find\n"
        "- search_queries: list of 3 query strings for Exa neural search\n"
        "- signal_type: one of hand_raiser, pain_expression, help_request, failed_diy, hiring_signal, life_event\n\n"
        "Strategies should explore adjacent audiences and topics to winners.\n"
        "Do NOT regenerate retired strategies or close variants.\n"
        "YAML list only, no other text:"
    )

    try:
        result = subprocess.run(
            ["claude", "-p", "--output-format", "text", prompt],
            capture_output=True, text=True, timeout=120,
            cwd=str(Path(__file__).resolve().parent),
        )
        raw = result.stdout.strip()
        if result.returncode != 0:
            logger.warning("Strategy generation failed: %s", result.stderr[:200])
            return []

        # Strip code fences
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])

        generated = yaml.safe_load(raw.strip())
        if not isinstance(generated, list):
            logger.warning("Strategy generation returned non-list")
            return []

        # Validate each strategy
        valid = []
        required = {"id", "source", "objective", "search_queries", "signal_type"}
        retired_queries = {q for s in retired_strategies for q in s.get("search_queries", [])}
        for s in generated[:MAX_GENERATE_PER_EVENT]:
            if not isinstance(s, dict):
                continue
            if not required.issubset(s.keys()):
                continue
            if not isinstance(s.get("search_queries"), list) or len(s["search_queries"]) < 1:
                continue
            # Check overlap with each retired strategy individually (not union)
            new_words = set(" ".join(s["search_queries"]).lower().split())
            too_similar = False
            for retired_s in retired_strategies:
                retired_words = set(" ".join(retired_s.get("search_queries", [])).lower().split())
                if retired_words and len(new_words & retired_words) / max(len(new_words), 1) > 0.6:
                    logger.info("SKIP generated strategy %s (too similar to retired %s)",
                                s["id"][:40], retired_s.get("id", "")[:40])
                    too_similar = True
                    break
            if too_similar:
                continue
            valid.append(s)

        logger.info("Generated %d new strategies (%d valid of %d proposed)",
                     len(valid), len(valid), len(generated))
        return valid

    except subprocess.TimeoutExpired:
        logger.warning("Strategy generation timed out")
    except Exception as exc:
        logger.warning("Strategy generation failed: %s", exc)
    return []
```

- [ ] **Step 2: Update `mutate_strategies()` to call generate**

Modify the existing `mutate_strategies()`:
1. Change retirement threshold from 2 cycles to 3 cycles (per spec)
2. After retiring, if `len(active) < MIN_STRATEGY_COUNT`, call `generate_strategies()`
3. Append generated strategies to `active`
4. Cap total at `MAX_STRATEGY_COUNT`
5. Pass `config` and `scoreboard_text` as new parameters

- [ ] **Step 3: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): add generate operation to mutation engine"
```

### Task 7: Add golden sources management

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Add golden source tracking functions**

```python
def update_golden_sources(golden_sources: list[dict], cycle_leads: list[dict]) -> list[dict]:
    """Check if any post author yielded 3+ leads and add them to golden sources."""
    # Count leads per source author
    author_leads: dict[str, list] = {}
    for lead in cycle_leads:
        author = lead.get("source_author", "")
        if author:
            author_leads.setdefault(author, []).append(lead)

    existing_authors = {s["author"] for s in golden_sources}

    for author, leads in author_leads.items():
        if len(leads) >= 3 and author not in existing_authors:
            avg_score = sum(l.get("score", 0) for l in leads) / len(leads)
            golden_sources.append({
                "author": author,
                "source_post": leads[0].get("source_post", ""),
                "lead_count": len(leads),
                "avg_score": round(avg_score, 2),
                "date_added": datetime.now(UTC).strftime("%Y-%m-%d"),
            })
            logger.info("NEW GOLDEN SOURCE: %s (%d leads, avg score %.2f)",
                        author[:40], len(leads), avg_score)

    return golden_sources
```

- [ ] **Step 2: Wire golden sources into main loop**

In `main()`:
1. Load golden sources from state (or empty list)
2. Pass golden sources to `run_cycle()`
3. After each cycle, call `update_golden_sources()` with the cycle's leads
4. Persist golden sources in state JSON
5. Write `golden-sources.json` to output dir

- [ ] **Step 3: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): add golden sources flywheel"
```

---

## Chunk 5: Error Handling + State Safety + Main Loop

### Task 8: Fix critical error handling gaps

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 0: Add retry helper with exponential backoff**

```python
def _retry_with_backoff(fn, max_retries: int = 3, base_delay: float = 2.0):
    """Call fn(), retrying on rate-limit errors with exponential backoff."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            err = str(exc).lower()
            is_rate_limit = "429" in err or "rate limit" in err or "too many requests" in err
            if not is_rate_limit or attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning("Rate limited (attempt %d/%d), backing off %.1fs: %s",
                           attempt + 1, max_retries, delay, str(exc)[:100])
            time.sleep(delay)
```

Use this wrapper in `exa_discover_posts()`, `apify_check_engagement()`, and `linkedin_mine_comments()` around the API calls. Example:
```python
# In exa_discover_posts, replace:
#   result = exa.search(...)
# With:
    result = _retry_with_backoff(lambda: exa.search(query, type="neural", ...))
```

- [ ] **Step 1: Add Exa auth error detection**

In `exa_discover_posts()`, catch authentication errors specifically:
```python
except Exception as exc:
    err_msg = str(exc).lower()
    if "unauthorized" in err_msg or "invalid api key" in err_msg or "401" in err_msg:
        logger.error("EXA_API_KEY invalid or expired. Exiting.")
        sys.exit(1)
    logger.warning("Exa search failed for %r: %s", query[:40], exc)
```

- [ ] **Step 2: Add Apify billing limit early abort**

Already handled in `filter_by_engagement()` (Task 4 Step 2). Also add to `linkedin_mine_comments()`:
```python
except Exception as exc:
    err_msg = str(exc).lower()
    if "usage hard limit" in err_msg or "billing" in err_msg:
        raise  # Propagate to cycle loop for clean abort
    logger.error("Comment mining failed for %s: %s", post_url[:60], exc)
    return []
```

- [ ] **Step 3: Add atomic state writes**

Replace all `state_path.write_text(json.dumps(...))` calls with:
```python
def save_state(state_path: Path, state: dict):
    """Atomic state write — temp file then rename."""
    tmp_path = state_path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(state, default=str))
    os.replace(str(tmp_path), str(state_path))
```

- [ ] **Step 4: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "fix(autoresearch): critical error handling — auth, billing, atomic state"
```

### Task 9: Rewrite main() for config-driven operation

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Rewrite main()**

Rewrite `main()` to:
1. Parse args with `--config` (required) and `--dry-run`
2. Call `load_config(args.config)`
3. Initialize Exa key (required) and Apify client (required unless `--dry-run`)
4. Load state including `seen_post_urls`, `seen_profile_urls`, `golden_sources`
5. Run cycle loop calling new `run_cycle()` with config
6. After each cycle: mutate strategies, update golden sources, save state atomically, write reports
7. Handle `KeyboardInterrupt` and crash recovery with atomic state saves
8. Print final summary

- [ ] **Step 2: Update state schema with explicit trimming**

State JSON now includes:
```python
{
    "seen_post_urls": [...],
    "seen_profile_urls": [...],
    "cycle_results": [...],  # last 20 only
    "all_leads": [...],
    "strategies": [...],
    "golden_sources": [...],
    "next_cycle": N,
}
```

Add an explicit trimming step before saving state:
```python
MAX_CYCLE_RESULTS_IN_STATE = 20

# Trim cycle_results to last 20 — older cycles are already archived in outputs/logs/
if len(cycle_results) > MAX_CYCLE_RESULTS_IN_STATE:
    cycle_results = cycle_results[-MAX_CYCLE_RESULTS_IN_STATE:]
```

Call this before every `save_state()` call in the main loop and in the crash recovery path.

- [ ] **Step 3: Update run.sh**

Update `ops/autoresearch/run.sh` to accept `--config` and `--dry-run` flags and pass them through. Remove the old `--linkedin-only` and `--exa-only` references. **Keep the existing `--bg` flag handling** (nohup + PID file + log redirect) — it already works and the spec expects it.

- [ ] **Step 4: Commit**

```bash
git add ops/autoresearch/autoresearch.py ops/autoresearch/run.sh
git commit -m "feat(autoresearch): config-driven main loop with dry-run support"
```

---

## Chunk 6: Output Reports + Cleanup

### Task 10: Update scoreboard and leads report for new pipeline

**Files:**
- Modify: `ops/autoresearch/autoresearch.py`

- [ ] **Step 1: Update `write_scoreboard()`**

The scoreboard should now show:
- Strategy performance ranked by leads/dollar (not just leads count)
- Golden sources section with author names, last checked date, cumulative leads
- Mutation engine activity (strategies generated/retired this cycle)
- Cost breakdown: Exa queries, engagement checks, comment mines, enrichments
- Overall leads/dollar trend

Use `config["name"]` in the header instead of hardcoded "Milo".

- [ ] **Step 2: Update `write_leads_report()`**

Use `config["name"]` and `config["icp"]["summary"]` instead of hardcoded values. Group by signal_type instead of channel (since V2 is LinkedIn-only).

- [ ] **Step 3: Remove dead code**

Delete:
- `exa_search()` (replaced by `exa_discover_posts()`)
- `exa_search_category()` (dropped for V1)
- `linkedin_search_posts()` (replaced by Exa for discovery + `apify_check_engagement()` for verification)
- `build_strategies()` (replaced by YAML config)
- All hardcoded query lists (`LINKEDIN_QUERIES`, `EXA_QUERIES`, `EXA_DOMAINS`, `EXA_CATEGORIES`)
- Regex patterns and `score_comment_regex()` stay (used in Phase 3a)
- `llm_evaluate_batch()` stays (used in Phase 3b, updated signature)
- `linkedin_mine_comments()` stays (used in Phase 2)

- [ ] **Step 4: Clean up imports**

Remove any unused imports. Verify `yaml` is imported.

- [ ] **Step 5: Commit**

```bash
git add ops/autoresearch/autoresearch.py
git commit -m "feat(autoresearch): update reports, remove dead V1 code"
```

### Task 11: End-to-end dry-run validation

**Files:** None modified — validation only.

- [ ] **Step 1: Verify module loads**

```bash
cd ops/autoresearch
.venv/bin/python -c "
import autoresearch as ar
config = ar.load_config('configs/milo.yaml')
print(f'OK: {config[\"name\"]}, {len(config[\"seed_strategies\"])} strategies')
"
```

- [ ] **Step 2: Run dry-run with Milo config**

```bash
export $(grep -v '^#' ~/.config/pathos/secrets.env | xargs)
.venv/bin/python autoresearch.py --config configs/milo.yaml --once --dry-run -v
```

Expected: Exa discovers posts, engagement check filters them, logs show which posts would be mined. No Apify comment mining spend. No LLM eval.

- [ ] **Step 3: Run dry-run with Pathos config**

```bash
.venv/bin/python autoresearch.py --config configs/pathos.yaml --once --dry-run -v
```

Expected: Same as above but with Pathos strategies.

- [ ] **Step 4: If dry-runs pass and Apify credits are available, run one real cycle**

```bash
.venv/bin/python autoresearch.py --config configs/milo.yaml --once -v
```

Check: `cat outputs/scoreboard.md` and `cat outputs/debug/cycle-001-debug.json` for results.

- [ ] **Step 5: Final commit with any fixes from validation**

```bash
git add ops/autoresearch/
git commit -m "fix(autoresearch): fixes from end-to-end validation"
```

---

## Summary

| Task | What | Key Change |
|------|------|-----------|
| 1 | YAML configs | Create milo.yaml + pathos.yaml |
| 2 | Config loading | Replace hardcoded constants with YAML loader |
| 3 | Exa post discovery | Replace Apify post search with Exa neural search |
| 4 | Engagement check | Add Phase 1.5 Apify verification (15+ comments gate) |
| 5 | Rewrite run_cycle | New pipeline: Exa→engagement→mine→eval→enrich→notify |
| 6 | Generate operation | LLM-powered strategy generation via claude -p |
| 7 | Golden sources | Track winning authors, check them first each cycle |
| 8 | Error handling | Auth detection, billing abort, atomic state writes |
| 9 | Main loop | Config-driven operation with --dry-run support |
| 10 | Reports + cleanup | Update scoreboard/leads, delete dead V1 code |
| 11 | Validation | Dry-run + real cycle testing |
