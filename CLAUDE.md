# Milo Website — Brand & Code Guidelines

All pages on getmilo.dev MUST follow these rules. No exceptions.

## Design Direction: The Blueprint

Technical specification aesthetic. Warm-tinted OKLCH palette (hue 65), classical typography accents, grid-paper background, monospace spec labels. Ratio: ~70% tech / ~30% classical.

## Required Page Structure

Every HTML page must include, in this order:

```
1. <link rel="stylesheet" href="/milo-design-system.css">  (root-relative)
2. Google Fonts preconnect + link (Cormorant Garamond, Outfit, JetBrains Mono)
3. <div class="grid-bg" aria-hidden="true"></div>
4. <a href="#main" class="skip-link">Skip to main content</a>
5. Standard nav (see below)
6. Mobile menu (see below)
7. <main id="main"> ... </main>
8. Standard footer (see below)
9. Scroll reveal JS + mobile menu JS + focus trap JS (see below)
```

Pages in `/content/` are served via Vercel rewrites at nested paths (`/blog/*`, `/compare/*`) — always use root-relative CSS path (`/milo-design-system.css`).

## Standard Nav

```html
<nav class="nav" role="navigation" aria-label="Main">
  <div class="wrap">
    <a href="/" class="nav__logo">
      <span class="nav__logo-text">milo</span>
      <span class="nav__dot"></span>
    </a>
    <div class="nav__links">
      <a href="/agents" class="nav__link">Services</a>
      <a href="/security" class="nav__link">Security</a>
      <a href="/calculator" class="nav__link">Calculator</a>
      <a href="/build" class="nav__link">Build</a>
      <a href="/demo" class="nav__cta">Start a project</a>
    </div>
    <button class="nav__toggle" aria-label="Menu" aria-expanded="false" aria-controls="mobile-menu">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
```

- Add `nav__link--active` + `aria-current="page"` to the link matching the current page
- Content/blog/compare pages: no active link (they're not in the nav)

## Standard Mobile Menu

```html
<div class="mobile-menu" id="mobile-menu" role="dialog" aria-label="Navigation">
  <a href="/agents">Services</a>
  <a href="/security">Security</a>
  <a href="/calculator">Calculator</a>
  <a href="/build">Build</a>
  <a href="/demo">Start a project</a>
</div>
```

Links must match the nav exactly — Services, Security, Calculator, Build, Start a project.

## Standard Footer

```html
<footer class="footer">
  <div class="wrap">
    <div class="footer__logo">
      <span class="footer__logo-text">milo</span>
      <span class="footer__dot"></span>
    </div>
    <div class="footer__links">
      <a href="/agents">Services</a>
      <a href="/security">Security</a>
      <a href="/blog">Guides</a>
      <a href="https://github.com/getmilodev">GitHub</a>
    </div>
    <span class="footer__copy">&copy; 2026 Milo</span>
  </div>
</footer>
```

## Required JS (end of body)

Every page needs: scroll reveal (IntersectionObserver), mobile menu toggle, focus trap + Escape handler. See any main page (e.g., `agents.html`) for the exact JS block.

## Design System Rules

### Colors
- **Never use raw hex or OKLCH values.** Always reference CSS custom properties (`--gold-text`, `--text-2`, etc.)
- Use `--gold-text` (not `--gold`) for text on light backgrounds — `--gold` fails WCAG AA
- Use `--text-3` for captions/secondary text (AA-compliant)
- On dark surfaces: `--text-inv`, `--text-on-dark`, `--text-on-dark-muted`
- Warm-tinted neutrals only — all neutrals use hue 65, never pure gray

### Typography
- `--font-display` (Cormorant Garamond) — headings, pull quotes, brand mark, hero prices
- `--font-body` (Outfit) — body text, buttons, UI, nav
- `--font-mono` (JetBrains Mono) — spec labels, code, technical data, sidebar metadata
- Use the fluid type scale (`--text-xs` through `--text-4xl`) — never hardcode font sizes

### Layout
- Use `wrap` (max-width 1160px) or `wrap wrap--narrow` (max-width 720px) for content containers
- Use editorial layouts (asymmetric 2-col grids) — NOT card grids
- Use `stacked-list` / `stacked-item` for feature lists — NOT identical card repetition
- Use `comparison-table` for vs-tables
- Use `pricing-tier` rows for pricing — NOT card grids
- Use `cta-section` (dark inset with rounded corners) for bottom CTAs

### Blueprint Elements
- `grid-bg` — 60px grid background on every page
- `spec-label` — monospace labels on section markers (SPEC:001, LAND:001, BLOG:001, etc.)
- `spec-label--on-dark` — variant for dark surfaces (CTA sections)
- `section-marker--cta` — layout class for markers inside CTA sections
- `spec-coord` — secondary annotation text after spec labels

### Accessibility
- `skip-link` on every page
- `aria-current="page"` on active nav link
- `aria-expanded` + `aria-controls` on mobile menu toggle
- `role="dialog"` on mobile menu
- Focus trap + Escape key on mobile menu
- `aria-expanded` + `aria-controls` on FAQ accordions
- `sr-only` class for visually-hidden labels
- Body text links inside `<main>` get automatic underlines (CSS rule)
- `prefers-reduced-motion` respected — animations disabled

### Spacing
- 4pt base system: `--sp-1` (4px) through `--sp-32` (128px)
- Never hardcode pixel values for spacing — always use tokens

### Motion
- `ease-out-expo` for primary transitions
- `ease-out-quart` for secondary
- No bounce or elastic easing
- Scroll reveal via `reveal` class + IntersectionObserver
- `data-delay="1"` through `data-delay="4"` for stagger

### Anti-Patterns (DO NOT)
- Card grids (same-sized cards with icon + heading + text)
- Hero metric layouts (big number, small label, gradient accent)
- Gradient text
- Glassmorphism / blur effects
- Bounce/elastic easing
- System fonts (Inter, Roboto, Arial, -apple-system)
- Raw hex colors (#1a1a1a, #e53e3e, #2563eb, etc.)
- Inline styles that duplicate design system properties
- Centered-everything layouts
- Nested cards

## File Organization

```
/                       Root pages (index, agents, security, calculator, build, receptionist, ainative, demo)
/content/               SEO content (blog posts, industry landings, competitor comparisons)
/api/                   Vercel serverless functions
/ops/                   Internal operations docs (not served)
milo-design-system.css  Single source of truth for all styling
vercel.json             Rewrites, redirects, headers
sitemap.xml             All public URLs
```

## Vercel Routing

Content pages are served via rewrites in `vercel.json`:
- `/law-firms` → `/content/law-firm-landing.html`
- `/compare/answerconnect` → `/content/answerconnect-alternative.html`
- `/blog/best-ai-receptionist` → `/content/blog-best-ai-receptionist.html`
- etc.

All Stripe checkout links go through redirects: `/buy/starter`, `/buy/team`, `/buy/managed`.

## Preserving Content

When rewriting any page:
- **Never drop content** — every paragraph, statistic, quote, and CTA must survive
- **Preserve all links** — internal links, Stripe buy links, external links
- **Preserve structured data** — JSON-LD (Service, FAQPage, ProfessionalService, Article)
- **Preserve meta tags** — title, description, og:title, og:description, canonical
- **Preserve all JavaScript functionality** — calculators, forms, wizards, API calls
