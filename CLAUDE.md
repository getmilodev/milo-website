# Milo — AI Native Setup for Professional Services

Milo (getmilo.dev) helps founders and operators at professional-services firms turn AI from vague curiosity into practical operating advantage. We assess, build, and hand off — no lock-in, no recurring fees to us.

## Product / Pricing

| Stage | Price | What happens |
|-------|-------|--------------|
| AI Systems Assessment | $500 | 30-min diagnostic — where AI creates the most leverage first |
| AI Native Setup | From $2,500 | Build the first workflow, working session, full handoff |
| Expansion | Scoped after first win | Extend into additional workflows or team members |

Ongoing infrastructure: $30–60/mo (client's own hosting/model usage, not to Milo).

## ICP

3-to-15-person professional-services firm (agencies, consulting, law, accounting) whose founder or operator knows AI should be making them faster but hasn't gotten past ChatGPT — and has at least one weekly workflow (proposals, reporting, follow-up, or research) that's still entirely manual.

**Industry tiers:** Tier 1 (clearest fit): agencies, consulting. Tier 2: law, accounting. Tier 3: real estate, recruiting.

## Competitive Position

- We build around real recurring workflows, not vague AI ambitions
- One-time pricing in a market of monthly subscriptions
- The receptionist/phone-answering product line and per-agent pricing ($399) are **dead**. Never reference them in new content.

<important>
HARD STOPS — things Claude must NEVER do in this project:
1. Reference "AI receptionist", "phone answering", or "answering service" as Milo's product
2. Reference $399 or per-agent pricing — current pricing is $500 assessment / $2,500+ setup
3. Use raw hex or OKLCH color values — always use CSS custom properties from the design system
4. Use card grids, gradient text, glassmorphism, system fonts, or any anti-pattern from ref/design-system.md
5. Push with `gh` CLI (smillunchick account has no access) — always use the getmilodev PAT
6. Drop content when rewriting pages — every paragraph, link, JSON-LD, and meta tag must survive
7. Use `--gold` for text — it fails WCAG AA. Use `--gold-text` instead
8. Add /security to the nav — it's accessible by URL only, not promoted
</important>

## Deploy Workflow

Static HTML site on Vercel. Auto-deploys on push to main.

```bash
# Always pull first (remote may have diverged)
cd ~/Projects/milo-inbox
git pull --rebase

# After changes: commit and push
git add <changed-files>
git commit -m "Description"
git push https://getmilodev:<PAT>@github.com/getmilodev/milo-inbox.git main
```

After creating/editing pages, ALWAYS commit and push. Don't write files and stop — changes must go live.

New pages require: rewrite in `vercel.json` + add route to cache header regex.

## Architecture

- Static HTML, no build step, no bundler
- All pages are single-file (inline CSS + JS)
- Shared styles: `milo-design-system.css` (single source of truth)
- Routes: `vercel.json` rewrites section (redirects handle deprecated content)
- API: `api/` directory (Vercel serverless functions)
- Ops: `ops/` directory (internal docs — not served)
- Content: `content/` directory (blog posts, industry landings)
- Stripe checkout: redirects in `vercel.json` (`/buy/starter`, `/buy/team`)

## Nav Structure

Services(/agents), Audit(/audit), Calculator(/calculator), Build(/build), Start a project(/demo) — 5 items, do not add more without discussion.

## Key Pages

| Page | Purpose |
|------|---------|
| index.html | Homepage — value prop, editorial services overview, terminal proof |
| agents.html | Services for operator-led teams (proposals, reporting, follow-up, research) |
| executives.html | AI Native for founders/executives (1-on-1 personal advantage) |
| ainative.html | Canonical product page — full AI Native Setup value prop |
| audit.html | Free AI assessment wizard → personalized report (in nav) |
| build.html | 3-step workflow configurator → blueprint |
| calculator.html | ROI calculator → cost of manual work |
| demo.html | Lead form / assessment booking (reads `ref` param for attribution) |
| blog.html | Blog index (featured + stacked list layout) |
| industries.html | Industry overview (law, accounting + "your industry" catch-all) |
| security.html | Security services — not in nav, accessible by URL only |

## Deprecated Content (301 redirected)

All competitor comparison pages (/compare/*), non-ICP industry landings (/dental, /hvac, /veterinary), /why-so-cheap, and 5 blog posts with old per-agent pricing are 301 redirected. See `vercel.json` redirects section for the full list. The HTML files still exist on disk but are never served.

## Design System

Read `@ref/design-system.md` when creating or editing pages — covers colors, typography, spacing, motion, layout patterns, and anti-patterns.

## Page Templates

Read `@ref/page-structure.md` when creating new pages or modifying nav/footer — contains exact HTML for nav, mobile menu, footer, required JS, and accessibility checklist.

## Verification

When starting a new task, confirm you've read this file by mentioning "Milo" and the relevant product context.
