# Milo outbound DNS zone files

These zone files are intended for Porkbun upload.

Files included:
- getmilo.dev.zone
- hellomilo.co.zone
- hiremilo.co.zone
- usemilo.co.zone
- runmilo.co.zone
- milohq.co.zone

Notes
- `getmilo.dev` is the primary brand / site domain and should not be used for cold outbound.
- Secondary cold-outbound domains are:
  - hellomilo.co
  - hiremilo.co
  - usemilo.co
  - runmilo.co
  - milohq.co
- Google verification TXT records were included from the operator-provided values.
- Existing verified AgentMail domains (`hellomilo.co`, `hiremilo.co`, `usemilo.co`, `getmilo.dev`) were generated from current AgentMail domain records.
- New domains (`runmilo.co`, `milohq.co`) were generated from the AgentMail domain create responses on 2026-03-12.
