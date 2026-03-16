"""Signal-first prospect discovery engine.

Finds high-quality prospects (.8+ LLM score) showing active buying behavior
on LinkedIn. Uses Exa for cheap post discovery, Apify for targeted comment
mining on engagement-verified posts, and claude -p for free LLM evaluation.

Follows Karpathy's autoresearch philosophy:
  - Fixed cost budget per cycle (Exa queries + Apify mines)
  - Single metric: leads per dollar at .8+ quality
  - Single mutation surface: only the strategy list evolves
  - Business config as program.md: ICP, eval prompt, seed strategies
  - Autonomous overnight iteration with crash-safe state

Usage:
    cd ops/autoresearch
    python autoresearch.py --config configs/milo.yaml --once
    python autoresearch.py --config configs/milo.yaml --once --dry-run
    python autoresearch.py --config configs/pathos.yaml --cycles 50

Env vars (source ~/.config/pathos/secrets.env):
    APIFY_API_TOKEN — required (comment mining + enrichment)
    EXA_API_KEY     — required (post discovery)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import time
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("autoresearch")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CYCLE_SLEEP_SECONDS = 120
MIN_COMMENT_LENGTH = 40
STATE_FILE = "autoresearch_state.json"
LLM_SCORE_THRESHOLD = 0.8
MIN_COMMENTS_FOR_MINING = 15
MAX_ENGAGEMENT_CHECKS_PER_CYCLE = 10
MAX_POSTS_TO_MINE = 3
MAX_COMMENTS_PER_POST = 500
LLM_BATCH_SIZE = 30
MIN_STRATEGY_COUNT = 15
MAX_STRATEGY_COUNT = 40
MAX_GENERATE_PER_EVENT = 5
MAX_CYCLE_RESULTS_IN_STATE = 20
GOLDEN_SOURCE_THRESHOLD = 3  # leads from one post to become golden

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

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
            logger.warning(
                "Rate limited (attempt %d/%d), backing off %.1fs: %s",
                attempt + 1, max_retries, delay, str(exc)[:100],
            )
            time.sleep(delay)


# ---------------------------------------------------------------------------
# Regex pre-filter (business-agnostic noise removal)
# ---------------------------------------------------------------------------

_OPERATIONAL_PAIN = re.compile(
    r"\b("
    r"i (spend|spent|waste|wasted|lose|lost) .{0,30}(hours?|time|days?)"
    r"|still (doing|writing|creating|building|handling|managing|does|do) .{0,25}manually"
    r"|(proposals?|reports?|invoic|follow[- ]?up|admin|research|reporting).{0,15}(takes?|taking|eat|killing|draining)"
    r"|our (process|workflow|system) is (broken|manual|terrible|slow|outdated|a mess)"
    r"|wearing every hat"
    r"|too (small|busy) (to|for) (hire|build|implement|automate|figure)"
    r"|can't (afford|justify|find) .{0,20}(hire|developer|engineer|consultant|AI person)"
    r"|drowning in (admin|paperwork|manual|operations|busywork)"
    r")\b",
    re.IGNORECASE,
)

_AI_FRUSTRATION = re.compile(
    r"\b("
    r"tried (ChatGPT|Claude|AI|GPT|Copilot|Gemini) .{0,50}(didn.t|couldn.t|can.t|wasn.t|failed|gave up|not enough|didn't)"
    r"|(ChatGPT|Claude|AI|GPT|automation) (isn't|is not|wasn't|not) (enough|working|useful|practical|reliable)"
    r"|AI (feels|seemed|seems|is) .{0,15}(overhyped|overrated|useless|impractical|confusing|frustrating)"
    r"|gave up on (AI|automation|ChatGPT)"
    r"|wasted (time|money|weeks|months) (on|trying|with) (AI|ChatGPT|automation|tools)"
    r"|AI .{0,15}(didn't|doesn't) (stick|work|help|deliver|scale)"
    r"|how do (you|I|we|other|small) .{0,30}(actually|really) (use|implement|adopt|integrate) AI"
    r"|everyone (talks|says|recommends) .{0,15}AI .{0,15}(but|yet|however)"
    r")\b",
    re.IGNORECASE,
)

_HELP_SEEKING = re.compile(
    r"\b("
    r"how do (you|other|small|I|we) .{0,30}(automate|use AI|implement|handle|manage|streamline)"
    r"|anyone (recommend|using|found|tried|know|have experience)"
    r"|what (tools?|system|platform|approach|service) .{0,20}(do you|works|for) .{0,20}(small|agency|firm|practice)"
    r"|looking for .{0,20}(help|someone|consultant|agency|service) .{0,15}(with|to|for) .{0,15}(AI|automat)"
    r"|need (help|advice|guidance|recommendations) .{0,15}(with|on|for|about) .{0,15}(AI|automat|workflow)"
    r"|where do I (start|begin|find|look) .{0,15}(with|for) .{0,15}(AI|automat)"
    r")\b",
    re.IGNORECASE,
)

_FIRM_IDENTITY = re.compile(
    r"\b("
    r"(my|our|I run a?|I own a?|founded a?|partner at) .{0,15}(agency|firm|practice|consultancy|consulting|studio|shop)"
    r"|team of (\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)"
    r"|small (agency|firm|practice|consultancy|consulting|studio|shop|business|company)"
    r"|(agency|firm|practice|consultancy) (owner|founder|partner|principal|operator)"
    r")\b",
    re.IGNORECASE,
)

_CHEERLEADING = re.compile(
    r"^\s*("
    r"great (post|article|share|point|insight|take)|love this|so true|needed this|well said"
    r"|this is (gold|fire|everything|it|spot on|so good)|thank(s| you) for (sharing|posting|this)"
    r"|couldn't agree more|preach|exactly|100%|absolutely|amen|nailed it|say it louder"
    r"|following|bookmarked|saving this|yes!*|congratulations|congrats|so inspiring"
    r"|so proud|amazing (post|article|take)|wonderful"
    r")\s*[!.]*\s*$",
    re.IGNORECASE,
)

_VENDOR = re.compile(
    r"\b("
    r"AI (agency|consultancy|consulting|automation|solutions|services|implementation)"
    r"|(agency|consultancy) .{0,10}(helping|that helps|we help|I help) .{0,20}(businesses|companies|firms|clients)"
    r"|book a (demo|call|consultation|meeting)"
    r"|DM me (for|to|about)|check out (my|our) .{0,10}(website|tool|platform|service|product|solution)"
    r"|founder .{0,5}(at|of|@) .{0,20}(\.ai|\.io|tech|labs|digital|solutions)"
    r"|we (offer|provide|build|deliver) .{0,15}(AI|automation|solutions)"
    r")\b",
    re.IGNORECASE,
)

_COMPETITOR_HEADLINE = re.compile(
    r"\b("
    r"AI (agency|consultant|automation|solutions|strategist|advisor|implementer)"
    r"|automation (agency|consultant|specialist|expert)"
    r"|helping .{0,20}(businesses|companies|firms|clients) .{0,15}(with|adopt|implement|leverage|use) AI"
    r"|digital transformation|process automation consultant"
    r"|founder .{0,5}(at|of|@) .{0,20}(\.ai|\.io|tech|digital|solutions|labs)"
    r")\b",
    re.IGNORECASE,
)


def score_comment_regex(text: str, headline: str = "") -> tuple[float, str]:
    """Fast pre-filter. Only eliminates obvious noise — cheerleading, vendors,
    short comments. Everything else goes to LLM eval."""
    if not text or len(text.strip()) < MIN_COMMENT_LENGTH:
        return 0.0, "too short"
    t = text.strip()
    if _CHEERLEADING.match(t):
        return 0.0, "cheerleading"
    if _COMPETITOR_HEADLINE.search(headline):
        return 0.0, "competitor"
    if _VENDOR.search(t) and not _OPERATIONAL_PAIN.search(t) and not _AI_FRUSTRATION.search(t):
        return 0.0, "vendor self-promo"

    signals = 0
    reasons = []

    if _OPERATIONAL_PAIN.search(t):
        signals += 2
        reasons.append("operational pain")
    if _AI_FRUSTRATION.search(t):
        signals += 2
        reasons.append("AI frustration")
    if _HELP_SEEKING.search(t):
        signals += 1
        reasons.append("help-seeking")
    if _FIRM_IDENTITY.search(t):
        signals += 1
        reasons.append("firm identity")

    if signals >= 3:
        return 1.0, " + ".join(reasons)
    if signals >= 2:
        return 0.9, " + ".join(reasons)
    if signals >= 1:
        return 0.7, " + ".join(reasons)

    # Substantive first-person comment — let LLM decide
    if len(t) >= 80 and re.search(r"\b(I|my|we|our)\b", t, re.IGNORECASE):
        return 0.6, "first-person substantive"

    return 0.0, "no signal"


# ---------------------------------------------------------------------------
# Phase 1: Post Discovery (Exa)
# ---------------------------------------------------------------------------

def exa_discover_posts(api_key: str, strategy: dict, seen_post_urls: set[str]) -> list[dict]:
    """Use Exa neural search to find LinkedIn posts for a signal strategy."""
    try:
        from exa_py import Exa
    except ImportError:
        logger.error("exa_py not installed — run: pip install exa-py")
        return []

    exa = Exa(api_key=api_key)
    posts = []

    for query in strategy.get("search_queries", []):
        try:
            result = _retry_with_backoff(lambda q=query: exa.search(
                q,
                type="neural",
                num_results=10,
                contents={"text": {"max_characters": 300}},
                include_domains=["linkedin.com"],
            ))
            for r in result.results:
                url = r.url or ""
                if not url or url in seen_post_urls:
                    continue
                # Only keep feed posts (/posts/) — articles (/pulse/, /advice/) have 0 mineable comments
                if "/posts/" not in url:
                    continue
                posts.append({
                    "url": url,
                    "author": r.title or "",
                    "preview": (r.text or "")[:300],
                    "strategy_id": strategy["id"],
                    "query": query,
                })
        except Exception as exc:
            err_msg = str(exc).lower()
            if "unauthorized" in err_msg or "invalid api key" in err_msg or "401" in err_msg:
                logger.error("EXA_API_KEY invalid or expired. Exiting.")
                sys.exit(1)
            logger.warning("Exa search failed for %r: %s", query[:40], exc)

    logger.info(
        "  Exa strategy %s: %d queries → %d new posts",
        strategy["id"][:40], len(strategy.get("search_queries", [])), len(posts),
    )
    return posts


def exa_discover_poster_prospects(api_key: str, strategy: dict, seen_post_urls: set[str]) -> list[dict]:
    """Find LinkedIn posts where the POSTER is the prospect (no comment mining).

    For exa_poster strategies: the post author is describing their own pain.
    We extract their profile URL from the post URL and evaluate them directly.
    Cost: $0 Apify — Exa + claude -p only.
    """
    try:
        from exa_py import Exa
    except ImportError:
        return []

    exa = Exa(api_key=api_key)
    prospects = []

    for query in strategy.get("search_queries", []):
        try:
            result = _retry_with_backoff(lambda q=query: exa.search(
                q,
                type="neural",
                num_results=10,
                contents={"text": {"max_characters": 500}},
                include_domains=["linkedin.com"],
            ))
            for r in result.results:
                url = r.url or ""
                if not url or url in seen_post_urls:
                    continue
                if "/posts/" not in url:
                    continue
                # Extract username from post URL: /posts/USERNAME_slug
                parts = url.split("/posts/")
                if len(parts) < 2:
                    continue
                username = parts[1].split("_")[0]
                if not username:
                    continue
                profile_url = f"https://www.linkedin.com/in/{username}/"
                prospects.append({
                    "text": (r.text or "")[:500],
                    "name": (r.title or "").split("'s Post")[0].split(" posted")[0][:60],
                    "headline": "",  # not available from Exa
                    "profile_url": profile_url,
                    "comment_url": url,
                    "source_url": url,
                    "channel": "exa_poster",
                    "_source_post": url,
                    "_source_author": (r.title or "")[:60],
                    "_strategy": strategy["id"],
                    "_regex_score": 0.8,  # bypass regex — LLM evaluates directly
                    "_regex_reason": "poster-as-prospect",
                })
                seen_post_urls.add(url)
        except Exception as exc:
            err_msg = str(exc).lower()
            if "unauthorized" in err_msg or "invalid api key" in err_msg:
                logger.error("EXA_API_KEY invalid or expired. Exiting.")
                sys.exit(1)
            logger.warning("Exa poster search failed for %r: %s", query[:40], exc)

    logger.info(
        "  Exa poster strategy %s: %d queries → %d prospects",
        strategy["id"][:40], len(strategy.get("search_queries", [])), len(prospects),
    )
    return prospects


def exa_check_golden_sources(api_key: str, golden_sources: list[dict], seen_post_urls: set[str]) -> list[dict]:
    """Check golden source authors for new posts via Exa."""
    try:
        from exa_py import Exa
    except ImportError:
        return []

    if not golden_sources:
        return []

    exa = Exa(api_key=api_key)
    posts = []

    for source in golden_sources:
        author_name = source.get("author", "")
        if not author_name:
            continue
        try:
            result = _retry_with_backoff(lambda a=author_name: exa.search(
                f'"{a}" site:linkedin.com',
                type="neural",
                num_results=5,
                contents={"text": {"max_characters": 300}},
                include_domains=["linkedin.com"],
            ))
            new_count = 0
            for r in result.results:
                url = r.url or ""
                if not url or url in seen_post_urls:
                    continue
                if "/posts/" not in url:
                    continue
                posts.append({
                    "url": url,
                    "author": author_name,
                    "preview": (r.text or "")[:300],
                    "strategy_id": f"golden:{author_name[:30]}",
                    "query": f"golden source: {author_name}",
                    "is_golden": True,
                })
                new_count += 1
            if new_count:
                logger.info("Golden source %s: %d new posts", author_name[:30], new_count)
        except Exception as exc:
            logger.warning("Golden source check failed for %s: %s", author_name[:30], exc)

    return posts


# ---------------------------------------------------------------------------
# Phase 1.5: Engagement Verification (Apify)
# ---------------------------------------------------------------------------

def apify_check_engagement(client, post_url: str) -> int | None:
    """Check a LinkedIn post's comment count. Returns count or None on failure."""
    try:
        run = _retry_with_backoff(lambda: client.actor("harvestapi/linkedin-post-search").call(run_input={
            "searchQueries": [post_url],
            "maxPosts": 1,
            "sortBy": "relevance",
        }))
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        if items:
            eng = items[0].get("engagement") or {}
            return eng.get("comments", 0) or 0
    except Exception as exc:
        err_msg = str(exc).lower()
        if "usage hard limit" in err_msg or "billing" in err_msg:
            raise  # Propagate billing errors
        logger.warning("Engagement check failed for %s: %s", post_url[:60], exc)
    return None


def filter_by_engagement(client, posts: list[dict], seen_post_urls: set[str]) -> list[dict]:
    """Filter posts to those with 15+ comments. Sorted by comment count desc."""
    qualified = []
    for post in posts[:MAX_ENGAGEMENT_CHECKS_PER_CYCLE]:
        url = post["url"]
        if url in seen_post_urls:
            continue
        comment_count = apify_check_engagement(client, url)
        if comment_count is None:
            logger.info("    %s: engagement check failed — skipping", post["author"][:30])
            continue
        if comment_count < MIN_COMMENTS_FOR_MINING:
            logger.info("    %s: %d comments (need %d) — skipping",
                        post["author"][:30], comment_count, MIN_COMMENTS_FOR_MINING)
            continue
        post["comments"] = comment_count
        qualified.append(post)
        logger.info("    %s: %d comments — QUALIFIED", post["author"][:30], comment_count)

    qualified.sort(key=lambda p: p.get("comments", 0), reverse=True)
    return qualified


# ---------------------------------------------------------------------------
# Phase 2: Comment Mining (Apify)
# ---------------------------------------------------------------------------

def get_apify_client(api_token: str):
    from apify_client import ApifyClient
    return ApifyClient(api_token)


def mine_comments(client, post_url: str, max_comments: int = MAX_COMMENTS_PER_POST) -> list[dict]:
    """Scrape comments from a LinkedIn post."""
    try:
        run = _retry_with_backoff(lambda: client.actor("harvestapi/linkedin-post-comments").call(run_input={
            "posts": [post_url],
            "maxItems": max_comments,
            "profileScraperMode": "short",
        }))
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as exc:
        err_msg = str(exc).lower()
        if "usage hard limit" in err_msg or "billing" in err_msg:
            raise  # Propagate billing errors
        logger.error("Comment mining failed for %s: %s", post_url[:60], exc)
        return []

    comments = []
    for item in items:
        text = item.get("commentary", "")
        if not text:
            continue
        actor = item.get("actor") or {}
        eng = item.get("engagement") or {}
        comments.append({
            "text": text.strip(),
            "name": actor.get("name", ""),
            "headline": actor.get("position", ""),
            "profile_url": actor.get("linkedinUrl", ""),
            "comment_url": item.get("linkedinUrl", ""),
            "likes": eng.get("likes", 0),
            "replies": eng.get("comments", 0),
            "channel": "linkedin",
        })
    return comments


# ---------------------------------------------------------------------------
# Phase 3b: LLM Evaluation (claude -p)
# ---------------------------------------------------------------------------

def llm_evaluate_batch(candidates: list[dict], config: dict) -> list[dict]:
    """Batch-evaluate candidates via Claude Code headless (OAuth).

    Returns list of {index, approved, score, buyer_type, reasoning}.
    """
    if not candidates:
        return []

    entries = []
    for i, c in enumerate(candidates):
        headline = c.get("headline", "")[:120]
        text = c.get("text", "")[:400]
        source = c.get("_source_post", "")[:100]
        parts = [f"[{i}] CHANNEL: linkedin"]
        if headline:
            parts.append(f"HEADLINE: {headline}")
        parts.append(f"SOURCE: {source}")
        parts.append(f"TEXT: {text}")
        entries.append("\n".join(parts))

    # Compose prompt: preamble + config eval_prompt + batch entries + output format
    preamble = (
        f"You evaluate prospects for {config['name']}.\n"
        f"ICP: {config['icp']['summary']}\n\n"
    )
    criteria = config["eval_prompt"]
    entries_text = "\n\n".join(entries)
    output_format = (
        "\n\nPROSPECTS TO EVALUATE:\n\n"
        + entries_text
        + "\n\nRespond with a JSON array. For each entry:\n"
        '{"index": N, "approved": bool, "score": 0.0-1.0, '
        '"buyer_type": str, "reasoning": "one sentence"}\n'
        "JSON array only, no other text:"
    )
    prompt = preamble + criteria + output_format

    try:
        result = subprocess.run(
            ["claude", "-p", "--output-format", "text", prompt],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(Path(__file__).resolve().parent),
        )
        raw = result.stdout.strip()
        logger.debug("claude -p raw response (%d chars): %s", len(raw), raw[:500])
        if result.returncode != 0:
            logger.warning("claude -p returned %d: %s", result.returncode, result.stderr[:200])
            return []

        # Strip markdown code fences
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])
        raw = raw.strip()
        start = raw.find("[")
        end = raw.rfind("]")
        if start != -1 and end != -1:
            evaluations = json.loads(raw[start : end + 1])
            approved = sum(1 for e in evaluations if e.get("approved"))
            logger.info(
                "LLM evaluated %d candidates, %d approved", len(evaluations), approved
            )
            return evaluations
        else:
            logger.warning("claude -p response has no JSON array: %s", raw[:200])
    except subprocess.TimeoutExpired:
        logger.warning("claude -p timed out")
    except json.JSONDecodeError as exc:
        logger.warning("claude -p JSON parse failed: %s — raw: %s", exc, raw[:200])
    except Exception as exc:
        logger.warning("LLM batch eval failed: %s", exc)
    return []


# ---------------------------------------------------------------------------
# Phase 4: Enrichment (Apify)
# ---------------------------------------------------------------------------

def enrich_profile(client, profile_url: str) -> dict:
    """Fetch full LinkedIn profile for an approved lead."""
    try:
        run = _retry_with_backoff(lambda: client.actor("harvestapi/linkedin-profile-scraper").call(run_input={
            "queries": [profile_url],
        }))
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        if items:
            return items[0]
    except Exception as exc:
        logger.warning("Profile enrichment failed for %s: %s", profile_url[:60], exc)
    return {}


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def notify_leads(count: int, cycle_num: int):
    """Fire desktop notification when leads are found."""
    if count > 0:
        try:
            subprocess.run(
                ["notify-send", "Autoresearch",
                 f"{count} new lead{'s' if count != 1 else ''} found (cycle {cycle_num})"],
                timeout=5,
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Core cycle
# ---------------------------------------------------------------------------

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
    }


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
    """Run one autoresearch cycle."""
    cycle_start = time.time()
    strategy_stats: dict[str, dict] = {}
    all_posts: list[dict] = []

    # --- Phase 1: Post Discovery (Exa) ---
    logger.info("Phase 1: Discovering posts via Exa (%d strategies)...", len(strategies))

    # Check golden sources first (cheapest, highest-yield)
    golden_posts = exa_check_golden_sources(exa_key, golden_sources, seen_post_urls)
    all_posts.extend(golden_posts)

    # Run each strategy's Exa queries
    poster_candidates: list[dict] = []  # exa_poster prospects bypass comment mining
    for strategy in strategies:
        sid = strategy["id"]
        source = strategy.get("source", "exa_deep")

        if source == "exa_poster":
            # Poster-as-prospect: no comment mining, goes straight to LLM eval
            prospects = exa_discover_poster_prospects(exa_key, strategy, seen_post_urls)
            poster_candidates.extend(prospects)
            strategy_stats[sid] = {
                "posts_found": len(prospects),
                "candidates": len(prospects),
                "regex_hits": len(prospects),
                "leads": 0,
            }
        else:
            posts = exa_discover_posts(exa_key, strategy, seen_post_urls)
            all_posts.extend(posts)
            strategy_stats[sid] = {
                "posts_found": len(posts),
                "candidates": 0,
                "regex_hits": 0,
                "leads": 0,
            }

    # Dedupe posts by URL
    seen_in_cycle = set()
    unique_posts = []
    for p in all_posts:
        if p["url"] not in seen_in_cycle and p["url"] not in seen_post_urls:
            seen_in_cycle.add(p["url"])
            unique_posts.append(p)

    logger.info("Phase 1 complete: %d unique candidate posts", len(unique_posts))

    if not unique_posts:
        logger.info("No new posts found. Cycle complete.")
        return _empty_cycle_result(cycle_num, cycle_start, strategy_stats)

    # --- Phase 1.5: LLM Post Filter (free — replaces broken Apify engagement check) ---
    # Pick the best posts to mine using claude -p on Exa preview text.
    # Cost: $0 (OAuth). Replaces the $1/check Apify engagement check.
    if len(unique_posts) > MAX_POSTS_TO_MINE:
        logger.info("Phase 1.5: LLM picking best %d of %d posts to mine...",
                    MAX_POSTS_TO_MINE, len(unique_posts))
        post_entries = []
        for i, p in enumerate(unique_posts[:30]):  # Cap at 30 to stay within prompt limits
            post_entries.append(f"[{i}] AUTHOR: {p['author'][:60]}\nURL: {p['url'][:80]}\nPREVIEW: {p['preview'][:150]}")

        filter_prompt = (
            f"You are selecting LinkedIn posts to mine for {config['name']} prospect discovery.\n"
            f"ICP: {config['icp']['summary']}\n\n"
            "Pick the 3 posts MOST LIKELY to have comments from ICP prospects.\n\n"
            "RULES:\n"
            "1. Pick from DIFFERENT industries/topics — do NOT pick 3 posts about the same thing.\n"
            "   If there are agency, law, accounting, AND consulting posts, pick from different ones.\n"
            "2. Prefer: posts by operators/practitioners sharing personal experience (comments will be peers sharing theirs).\n"
            "3. Prefer: posts that seem like feed posts with engagement, not articles or advice listicles.\n"
            "4. Avoid: vendor posts, how-to articles, listicles.\n\n"
            "POSTS:\n\n" + "\n\n".join(post_entries) +
            "\n\nRespond with a JSON array of the indices of the 3 best posts, e.g. [2, 7, 15].\n"
            "JSON array only:"
        )
        try:
            result = subprocess.run(
                ["claude", "-p", "--output-format", "text", filter_prompt],
                capture_output=True, text=True, timeout=60,
                cwd=str(Path(__file__).resolve().parent),
            )
            raw = result.stdout.strip()
            if raw.startswith("```"):
                raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = "\n".join(raw.split("\n")[:-1])
            raw = raw.strip()
            start = raw.find("[")
            end = raw.rfind("]")
            if start != -1 and end != -1:
                indices = json.loads(raw[start : end + 1])
                qualified_posts = [unique_posts[i] for i in indices if isinstance(i, int) and 0 <= i < len(unique_posts)]
                logger.info("LLM selected %d posts: %s", len(qualified_posts),
                           ", ".join(p["author"][:30] for p in qualified_posts))
            else:
                qualified_posts = unique_posts[:MAX_POSTS_TO_MINE]
                logger.warning("LLM post filter failed to parse — using first %d", MAX_POSTS_TO_MINE)
        except Exception as exc:
            qualified_posts = unique_posts[:MAX_POSTS_TO_MINE]
            logger.warning("LLM post filter failed: %s — using first %d", exc, MAX_POSTS_TO_MINE)
    else:
        qualified_posts = unique_posts

    if dry_run:
        logger.info("DRY RUN: Would mine %d posts. Stopping here.", len(qualified_posts))
        for p in qualified_posts:
            logger.info("  Would mine: %s — %s", p["author"][:40], p["url"][:60])
        result = _empty_cycle_result(cycle_num, cycle_start, strategy_stats)
        result["posts_discovered"] = len(unique_posts)
        result["posts_qualified"] = len(qualified_posts)
        return result

    # --- Phase 2: Comment Mining (Apify) ---
    posts_to_mine = qualified_posts[:MAX_POSTS_TO_MINE]
    logger.info("Phase 2: Mining comments on %d posts...", len(posts_to_mine))

    candidates = []
    posts_mined = 0
    for post in posts_to_mine:
        seen_post_urls.add(post["url"])
        posts_mined += 1

        comments = mine_comments(apify_client, post["url"])
        for c in comments:
            c["_source_post"] = post["url"]
            c["_source_author"] = post["author"]
            c["_strategy"] = post["strategy_id"]
            # Dedup commenters
            profile = c.get("profile_url", "")
            if profile and profile in seen_profile_urls:
                continue
            if profile:
                seen_profile_urls.add(profile)
            candidates.append(c)

        # Track per-strategy stats
        sid = post.get("strategy_id", "")
        if sid in strategy_stats:
            strategy_stats[sid]["candidates"] += len(comments)

        logger.info("  Mined %s: %d comments, %d new candidates",
                    post["author"][:30], len(comments),
                    sum(1 for c in comments if c.get("profile_url", "") not in seen_profile_urls or True))

    logger.info("Phase 2 complete: %d candidates from %d posts", len(candidates), posts_mined)

    # --- Phase 3a: Regex Pre-Filter ---
    regex_hits = []
    for c in candidates:
        score, reason = score_comment_regex(c.get("text", ""), c.get("headline", ""))
        if score >= 0.6:
            c["_regex_score"] = score
            c["_regex_reason"] = reason
            regex_hits.append(c)

    # Add poster-as-prospect candidates (bypass regex — already pre-qualified by Exa query)
    if poster_candidates:
        logger.info("Phase 3a (poster): %d poster-as-prospect candidates added", len(poster_candidates))
        regex_hits.extend(poster_candidates)

    logger.info("Phase 3a: %d total candidates for LLM eval (%d from comments, %d from posters)",
                len(regex_hits), len(regex_hits) - len(poster_candidates), len(poster_candidates))

    # --- Phase 3b: LLM Evaluation ---
    all_leads: list[dict] = []
    all_evaluations = []

    if regex_hits:
        logger.info("Phase 3b: LLM evaluating %d candidates via claude -p...", len(regex_hits))

        for batch_start in range(0, len(regex_hits), LLM_BATCH_SIZE):
            batch = regex_hits[batch_start : batch_start + LLM_BATCH_SIZE]
            evals = llm_evaluate_batch(batch, config)
            for ev in evals:
                if isinstance(ev, dict) and "index" in ev:
                    ev["index"] += batch_start
            all_evaluations.extend(evals)

        eval_map = {
            e["index"]: e for e in all_evaluations if isinstance(e, dict) and "index" in e
        }

        # Debug output
        debug_dir = Path("outputs/debug")
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_data = []
        for i, hit in enumerate(regex_hits):
            ev = eval_map.get(i, {})
            debug_data.append({
                "index": i,
                "name": hit.get("name", ""),
                "headline": hit.get("headline", ""),
                "text": hit.get("text", "")[:300],
                "regex_score": hit.get("_regex_score", 0),
                "regex_reason": hit.get("_regex_reason", ""),
                "strategy": hit.get("_strategy", ""),
                "llm_approved": ev.get("approved", False),
                "llm_score": ev.get("score", 0),
                "llm_buyer_type": ev.get("buyer_type", ""),
                "llm_reasoning": ev.get("reasoning", ""),
            })
        debug_path = debug_dir / f"cycle-{cycle_num:03d}-debug.json"
        debug_path.write_text(json.dumps(debug_data, indent=2, default=str))
        logger.info("Debug: %s (%d entries)", debug_path, len(debug_data))

        # Collect approved leads
        for i, hit in enumerate(regex_hits):
            ev = eval_map.get(i)
            if not ev or not ev.get("approved"):
                continue
            if ev.get("score", 0) < LLM_SCORE_THRESHOLD:
                continue

            sid = hit.get("_strategy", "unknown")
            lead = {
                "name": hit.get("name", ""),
                "headline": hit.get("headline", ""),
                "profile_url": hit.get("profile_url", ""),
                "comment_url": hit.get("comment_url", ""),
                "comment": hit.get("text", ""),
                "score": ev.get("score", hit["_regex_score"]),
                "buyer_type": ev.get("buyer_type", "none"),
                "reason": ev.get("reasoning", hit["_regex_reason"]),
                "regex_score": hit["_regex_score"],
                "source_post": hit.get("_source_post", ""),
                "source_author": hit.get("_source_author", ""),
                "strategy": sid,
                "likes": hit.get("likes", 0),
                "replies": hit.get("replies", 0),
            }
            all_leads.append(lead)

            if sid in strategy_stats:
                strategy_stats[sid]["leads"] = strategy_stats[sid].get("leads", 0) + 1

        # Track regex hits per strategy
        for hit in regex_hits:
            sid = hit.get("_strategy", "")
            if sid in strategy_stats:
                strategy_stats[sid]["regex_hits"] = strategy_stats[sid].get("regex_hits", 0) + 1

    # --- Phase 4: Enrichment (skipped for now — comment mining gives name/headline/URL) ---
    # TODO: Re-enable when budget allows. Each enrichment is ~$1.
    # if all_leads:
    #     for lead in all_leads:
    #         profile_data = enrich_profile(apify_client, lead.get("profile_url", ""))
    #         if profile_data:
    #             lead["enriched"] = True

    all_leads.sort(key=lambda x: x.get("score", 0), reverse=True)

    elapsed = time.time() - cycle_start
    return {
        "cycle": cycle_num,
        "timestamp": datetime.now(UTC).isoformat(),
        "elapsed_seconds": round(elapsed, 1),
        "strategies_run": len(strategies),
        "posts_discovered": len(unique_posts),
        "posts_qualified": len(qualified_posts),
        "posts_mined": posts_mined,
        "total_candidates": len(candidates),
        "regex_hits": len(regex_hits),
        "leads_found": len(all_leads),
        "leads": all_leads,
        "strategy_stats": strategy_stats,
    }


# ---------------------------------------------------------------------------
# Mutation engine
# ---------------------------------------------------------------------------

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
        "- search_queries: list of 3 query strings for Exa neural search on linkedin.com\n"
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

        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])

        generated = yaml.safe_load(raw.strip())
        if not isinstance(generated, list):
            logger.warning("Strategy generation returned non-list")
            return []

        valid = []
        required = {"id", "source", "objective", "search_queries", "signal_type"}
        for s in generated[:MAX_GENERATE_PER_EVENT]:
            if not isinstance(s, dict):
                continue
            if not required.issubset(s.keys()):
                continue
            if not isinstance(s.get("search_queries"), list) or len(s["search_queries"]) < 1:
                continue
            # Check overlap with each retired strategy individually
            new_words = set(" ".join(s["search_queries"]).lower().split())
            too_similar = False
            for retired_s in retired_strategies:
                retired_words = set(" ".join(retired_s.get("search_queries", [])).lower().split())
                if retired_words and len(new_words & retired_words) / max(len(new_words), 1) > 0.6:
                    logger.info("SKIP generated %s (too similar to retired %s)",
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
    except yaml.YAMLError as exc:
        logger.warning("Strategy generation YAML parse failed: %s", exc)
    except Exception as exc:
        logger.warning("Strategy generation failed: %s", exc)
    return []


def mutate_strategies(
    strategies: list[dict],
    cycle_results: list[dict],
    config: dict,
    scoreboard_text: str,
) -> tuple[list[dict], list[dict]]:
    """Evolve strategies: promote, retire, generate. Returns (active, retired)."""
    strategy_total_leads: dict[str, int] = {}
    strategy_cycles_seen: dict[str, int] = {}

    for result in cycle_results:
        for sid, stats in result.get("strategy_stats", {}).items():
            strategy_total_leads[sid] = strategy_total_leads.get(sid, 0) + stats.get("leads", 0)
            strategy_cycles_seen[sid] = strategy_cycles_seen.get(sid, 0) + 1

    # Sort: most leads first (promote)
    ranked = sorted(strategies, key=lambda s: strategy_total_leads.get(s["id"], 0), reverse=True)

    active = []
    retired = []
    for s in ranked:
        sid = s["id"]
        cycles = strategy_cycles_seen.get(sid, 0)
        leads = strategy_total_leads.get(sid, 0)
        if cycles >= 3 and leads == 0:
            retired.append(s)
            logger.info("RETIRE: %s (0 leads in %d cycles)", sid[:50], cycles)
        else:
            active.append(s)

    if retired:
        logger.info("Retired %d strategies. Active: %d", len(retired), len(active))

    # Generate if below minimum
    if len(active) < MIN_STRATEGY_COUNT and (retired or cycle_results):
        winning = [s for s in active if strategy_total_leads.get(s["id"], 0) > 0]
        generated = generate_strategies(config, scoreboard_text, winning, retired)
        active.extend(generated)

    if len(active) > MAX_STRATEGY_COUNT:
        active = active[:MAX_STRATEGY_COUNT]

    return active, retired


# ---------------------------------------------------------------------------
# Golden sources
# ---------------------------------------------------------------------------

def update_golden_sources(golden_sources: list[dict], cycle_leads: list[dict]) -> list[dict]:
    """Add authors who yielded 3+ leads from a single post to golden sources."""
    author_leads: dict[str, list] = {}
    for lead in cycle_leads:
        author = lead.get("source_author", "")
        if author:
            author_leads.setdefault(author, []).append(lead)

    existing_authors = {s["author"] for s in golden_sources}

    for author, leads in author_leads.items():
        if len(leads) >= GOLDEN_SOURCE_THRESHOLD and author not in existing_authors:
            avg_score = sum(l.get("score", 0) for l in leads) / len(leads)
            golden_sources.append({
                "author": author,
                "source_post": leads[0].get("source_post", ""),
                "lead_count": len(leads),
                "avg_score": round(avg_score, 2),
                "date_added": datetime.now(UTC).strftime("%Y-%m-%d"),
            })
            logger.info("NEW GOLDEN SOURCE: %s (%d leads, avg %.2f)",
                        author[:40], len(leads), avg_score)

    return golden_sources


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_cycle_log(result: dict, log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d-%H%M")
    path = log_dir / f"cycle-{result['cycle']:03d}-{timestamp}.json"
    with open(path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    return path


def write_leads_report(all_leads: list[dict], config: dict, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    path = output_dir / f"{today}-leads.md"

    lines = [
        f"# {config['name']} — Autoresearch Leads ({today})",
        "",
        f"**Total leads:** {len(all_leads)}",
        f"**ICP:** {config['icp']['summary']}",
        "",
        "---",
        "",
    ]

    seen = set()
    unique = []
    for lead in all_leads:
        key = lead.get("profile_url") or lead.get("comment_url") or lead.get("name", "")
        if key and key not in seen:
            seen.add(key)
            unique.append(lead)

    # Group by signal type
    by_type: dict[str, list] = {}
    for lead in unique:
        bt = lead.get("buyer_type", "unknown")
        by_type.setdefault(bt, []).append(lead)

    for buyer_type, leads in sorted(by_type.items()):
        lines.append(f"## {buyer_type} ({len(leads)} leads)")
        lines.append("")

        for lead in leads:
            name = lead.get("name", "Unknown")
            headline = lead.get("headline", "")
            profile = lead.get("profile_url", "")
            score = lead.get("score", 0)

            if profile:
                lines.append(f"### [{name}]({profile})")
            else:
                lines.append(f"### {name}")
            if headline:
                lines.append(f"*{headline}*")

            lines.append(f"**Score:** {score:.1f} | **Type:** {buyer_type}")
            lines.append(f"**Why:** {lead.get('reason', '')}")

            source = lead.get("source_author", "")
            source_post = lead.get("source_post", "")
            strategy = lead.get("strategy", "")
            lines.append(f"**Found via:** `{strategy[:50]}` → [{source[:40]}]({source_post})")

            comment_url = lead.get("comment_url", "")
            if comment_url:
                lines.append(f"**Link:** [{comment_url[:80]}...]({comment_url})")

            lines.append("")
            lines.append(f"> {lead.get('comment', '')[:400]}")
            lines.append("")
            lines.append("---")
            lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_scoreboard(
    cycle_results: list[dict],
    strategies: list[dict],
    golden_sources: list[dict],
    config: dict,
    output_dir: Path,
) -> tuple[Path, str]:
    """Write scoreboard. Returns (path, text) — text is also used by mutation engine."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "scoreboard.md"

    total_leads = sum(r.get("leads_found", 0) for r in cycle_results)

    lines = [
        f"# {config['name']} — Autoresearch Scoreboard",
        "",
        f"**Last updated:** {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')} UTC",
        f"**Cycles run:** {len(cycle_results)}",
        f"**Active strategies:** {len(strategies)}",
        f"**Golden sources:** {len(golden_sources)}",
        f"**Total leads:** {total_leads}",
        "",
        "## Cycle History",
        "",
        "| Cycle | Posts Found | Qualified | Mined | Candidates | Regex | Leads | Time |",
        "|-------|-----------|-----------|-------|------------|-------|-------|------|",
    ]

    for r in cycle_results[-20:]:
        elapsed = f"{r.get('elapsed_seconds', 0):.0f}s"
        lines.append(
            f"| {r['cycle']} | {r.get('posts_discovered', 0)} | "
            f"{r.get('posts_qualified', 0)} | {r.get('posts_mined', 0)} | "
            f"{r.get('total_candidates', 0)} | {r.get('regex_hits', 0)} | "
            f"{r.get('leads_found', 0)} | {elapsed} |"
        )

    # Strategy performance
    strategy_totals: dict[str, dict] = {}
    for r in cycle_results:
        for sid, stats in r.get("strategy_stats", {}).items():
            if sid not in strategy_totals:
                strategy_totals[sid] = {"leads": 0, "candidates": 0, "cycles": 0}
            strategy_totals[sid]["leads"] += stats.get("leads", 0)
            strategy_totals[sid]["candidates"] += stats.get("candidates", 0)
            strategy_totals[sid]["cycles"] += 1

    lines.extend([
        "",
        "## Strategy Performance",
        "",
        "| Strategy | Leads | Candidates | Cycles | Status |",
        "|----------|-------|------------|--------|--------|",
    ])

    sorted_strats = sorted(strategy_totals.items(), key=lambda x: x[1]["leads"], reverse=True)
    for sid, stats in sorted_strats[:30]:
        status = "KEEP" if stats["leads"] > 0 else ("RETIRE" if stats["cycles"] >= 3 else "TESTING")
        lines.append(f"| {sid[:55]} | {stats['leads']} | {stats['candidates']} | {stats['cycles']} | {status} |")

    # Golden sources
    if golden_sources:
        lines.extend([
            "",
            "## Golden Sources",
            "",
            "| Author | Leads | Avg Score | Added |",
            "|--------|-------|-----------|-------|",
        ])
        for gs in golden_sources:
            lines.append(
                f"| {gs['author'][:40]} | {gs['lead_count']} | "
                f"{gs['avg_score']:.1f} | {gs['date_added']} |"
            )

    text = "\n".join(lines)
    path.write_text(text, encoding="utf-8")
    return path, text


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------

def save_state(state_path: Path, state: dict):
    """Atomic state write — temp file then rename."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = state_path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(state, default=str))
    os.replace(str(tmp_path), str(state_path))


# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def load_env():
    """Load env vars from secrets file if not already set."""
    secrets_path = Path.home() / ".config" / "pathos" / "secrets.env"
    if secrets_path.exists():
        for line in secrets_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and not os.environ.get(key):
                    os.environ[key] = value


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Signal-first prospect discovery engine")
    parser.add_argument("--config", required=True, help="Path to business config YAML")
    parser.add_argument("--once", action="store_true", help="Run a single cycle")
    parser.add_argument("--cycles", type=int, default=0, help="Run N cycles (0=infinite)")
    parser.add_argument("--output", default="outputs", help="Output directory")
    parser.add_argument("--sleep", type=int, default=CYCLE_SLEEP_SECONDS, help="Seconds between cycles")
    parser.add_argument("--dry-run", action="store_true", help="Exa discovery + engagement check only")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    load_env()
    config = load_config(args.config)

    exa_key = os.environ.get("EXA_API_KEY")
    apify_token = os.environ.get("APIFY_API_TOKEN")

    if not exa_key:
        logger.error("EXA_API_KEY not set")
        sys.exit(1)
    if not apify_token and not args.dry_run:
        logger.error("APIFY_API_TOKEN not set (required unless --dry-run)")
        sys.exit(1)

    apify_client = get_apify_client(apify_token) if apify_token else None

    output_dir = Path(args.output)
    log_dir = output_dir / "logs"
    state_path = output_dir / STATE_FILE
    max_cycles = 1 if args.once else (args.cycles or 999)

    # Load state
    seen_post_urls: set[str] = set()
    seen_profile_urls: set[str] = set()
    cycle_results: list[dict] = []
    all_leads: list[dict] = []
    golden_sources: list[dict] = config.get("golden_sources", [])
    strategies: list[dict] = list(config["seed_strategies"])
    start_cycle = 1

    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
            seen_post_urls = set(state.get("seen_post_urls", []))
            seen_profile_urls = set(state.get("seen_profile_urls", []))
            cycle_results = state.get("cycle_results", [])
            all_leads = state.get("all_leads", [])
            golden_sources = state.get("golden_sources", golden_sources)
            start_cycle = state.get("next_cycle", 1)
            saved = state.get("strategies")
            if saved:
                strategies = saved
            logger.info(
                "Resumed: %d seen posts, %d seen profiles, %d leads, cycle %d",
                len(seen_post_urls), len(seen_profile_urls), len(all_leads), start_cycle,
            )
        except Exception as exc:
            logger.warning("Failed to load state, starting fresh: %s", exc)

    logger.info("=== %s AUTORESEARCH ===", config["name"].upper())
    logger.info("ICP: %s", config["icp"]["summary"][:80])
    logger.info("Strategies: %d | Golden sources: %d | Max cycles: %d",
                len(strategies), len(golden_sources), max_cycles)
    if args.dry_run:
        logger.info("MODE: DRY RUN (Exa + engagement check only, no comment mining)")
    logger.info("Metric: leads per dollar at .8+ quality")

    for cycle_num in range(start_cycle, start_cycle + max_cycles):
        try:
            logger.info(
                "=== CYCLE %d (%d strategies, %d golden, %d seen posts) ===",
                cycle_num, len(strategies), len(golden_sources), len(seen_post_urls),
            )

            result = run_cycle(
                config, apify_client, exa_key, strategies, golden_sources,
                seen_post_urls, seen_profile_urls, cycle_num, args.dry_run,
            )
            cycle_results.append(result)
            cycle_leads = result.get("leads", [])
            all_leads.extend(cycle_leads)

            # Log cycle
            log_path = write_cycle_log(result, log_dir)
            logger.info(
                "Cycle %d: %d discovered → %d qualified → %d mined → %d candidates → %d leads. Log: %s",
                cycle_num,
                result.get("posts_discovered", 0),
                result.get("posts_qualified", 0),
                result.get("posts_mined", 0),
                result["total_candidates"],
                result["leads_found"],
                log_path,
            )

            # Notify on leads
            notify_leads(result["leads_found"], cycle_num)

            # Update golden sources
            golden_sources = update_golden_sources(golden_sources, cycle_leads)

            # Write reports
            leads_path = write_leads_report(all_leads, config, output_dir)
            scoreboard_path, scoreboard_text = write_scoreboard(
                cycle_results, strategies, golden_sources, config, output_dir,
            )
            logger.info("Leads: %s | Scoreboard: %s", leads_path, scoreboard_path)

            # Mutate strategies
            strategies, retired = mutate_strategies(strategies, cycle_results, config, scoreboard_text)

            # Trim cycle_results for state (older cycles in logs/)
            trimmed_results = cycle_results[-MAX_CYCLE_RESULTS_IN_STATE:]

            # Persist state atomically
            save_state(state_path, {
                "seen_post_urls": list(seen_post_urls),
                "seen_profile_urls": list(seen_profile_urls),
                "cycle_results": trimmed_results,
                "all_leads": all_leads,
                "strategies": strategies,
                "golden_sources": golden_sources,
                "next_cycle": cycle_num + 1,
            })

            logger.info(
                "State saved. Strategies: %d | Golden: %d | Leads: %d",
                len(strategies), len(golden_sources), len(all_leads),
            )

            if cycle_num < start_cycle + max_cycles - 1 and not args.once:
                logger.info("Sleeping %ds...", args.sleep)
                time.sleep(args.sleep)

        except KeyboardInterrupt:
            logger.info("Interrupted. State saved. Resume at cycle %d.", cycle_num + 1)
            break
        except Exception as exc:
            logger.exception("Cycle %d crashed: %s", cycle_num, exc)
            try:
                save_state(state_path, {
                    "seen_post_urls": list(seen_post_urls),
                    "seen_profile_urls": list(seen_profile_urls),
                    "cycle_results": cycle_results[-MAX_CYCLE_RESULTS_IN_STATE:],
                    "all_leads": all_leads,
                    "strategies": strategies,
                    "golden_sources": golden_sources,
                    "next_cycle": cycle_num + 1,
                })
            except Exception:
                pass
            time.sleep(30)
            continue

    logger.info(
        "=== AUTORESEARCH COMPLETE ===\n"
        "Cycles: %d | Leads: %d | Unique: %d | Golden sources: %d",
        len(cycle_results),
        len(all_leads),
        len({l.get("profile_url") or l.get("name", "") for l in all_leads}),
        len(golden_sources),
    )


if __name__ == "__main__":
    main()
