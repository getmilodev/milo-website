# Apollo Prospect Pipeline — AI for Executives
*Created: 2026-03-09*

## API Status: VALIDATED ✅
- Endpoint: `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- Auth: `X-Api-Key` header
- Rate limits: 200/min, 6,000/hr, 50,000/day (free tier)

## Primary Search — COOs at Professional Services Firms

**Parameters:**
```json
{
  "q_organization_num_employees_ranges": ["51,200"],
  "person_titles": ["COO", "Chief Operating Officer", "VP Operations"],
  "person_locations": ["United States"],
  "q_organization_keyword_tags": ["professional services", "consulting", "accounting"],
  "per_page": 25
}
```

**Results:** 88,024 matching prospects

**Sample matches:**
- COO, Accounting Resources Inc. (has email + direct phone)
- COO, AURA Accounting Solutions (has email + direct phone)
- COO, Retanaco Accounting (has email + direct phone)

## Expansion Searches (Not Yet Run)

### Legal Services
```json
{
  "q_organization_keyword_tags": ["legal", "law firm", "legal services"],
  "person_titles": ["COO", "Managing Partner", "Director of Operations"]
}
```

### Financial Services / Wealth Management
```json
{
  "q_organization_keyword_tags": ["financial services", "wealth management", "insurance"],
  "person_titles": ["COO", "VP Operations", "Managing Director"]
}
```

### Broader Executive Titles (for /executives product)
```json
{
  "person_titles": ["VP Operations", "VP Strategy", "Chief of Staff", "Director of Operations"],
  "q_organization_num_employees_ranges": ["51,500"]
}
```

## Contact Enrichment

To get full contact details (unobfuscated names, emails, phones), use:
- `POST /api/v1/people/match` — single person lookup
- `POST /api/v1/people/bulk_match` — batch enrichment (up to 100 per request)

These consume email credits. Free tier includes credits for initial batches.

## Recommended Pipeline Flow

1. **Search** — Run primary search, filter by `has_email: true`
2. **Enrich** — Bulk match top 25 prospects per wave
3. **Personalize** — Research company + person via web for 1-2 sentence hook
4. **Send** — Use Template C from outbound-pipeline-v1.md (executives template)
5. **Track** — Monitor replies via milo-inbox, escalate positive responses to owner

## Sizing

| Search | Est. Matches | Product |
|--------|-------------|---------|
| COOs at professional services (51-200 emp) | 88,024 | AI for Executives |
| COOs at legal (51-200 emp) | ~30,000 (est.) | AI for Executives |
| COOs at financial services (51-200 emp) | ~45,000 (est.) | AI for Executives |
| Owners at service businesses (5-50 emp) | 200,000+ | AI Agent Teams |

**Total addressable pipeline: 350K+ US prospects across all product lines.**

At 50 emails/day, 2-3% reply rate, 25% close rate on replies:
- Monthly sends: ~1,000
- Monthly replies: 20-30
- Monthly customers: 5-8
- Monthly revenue at avg $2,500 ACV: $12,500-$20,000

## Next Steps
- [ ] Owner approves test batch (3 emails from pipeline v1)
- [ ] Run enrichment on first 25 COO prospects
- [ ] Personalize and send using Template C
- [ ] Expand to legal and financial services verticals
