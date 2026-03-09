# Outbound Email Pipeline v1

## Status: READY — Awaiting owner approval to send

## Pipeline Architecture
1. **Apollo.io** — 46K+ prospects across HVAC (20K), plumbing (22K), dental (4.7K)
2. **Enrichment** — Verified emails, company data, revenue, employee count
3. **Resend** — Verified domain: `join.getmilo.dev` (sending enabled)
4. **Tracking** — Reply monitoring via milo-inbox

## Decision Needed from Sam
- [ ] Approve test batch (3 emails below)
- [ ] Choose from-name (e.g., "Sam from Milo" vs "Milo Team")
- [ ] Choose from-address format for join.getmilo.dev
- [ ] Approve scaling plan (10/day → 25/day → 50/day over 2 weeks)

---

## Prospect Profiles (contact details stored in Apollo, not here)

### Prospect 1: HVAC Company Owner — Naperville, IL
- **Company:** Dutchman Heating and Cooling, Inc.
- **Revenue:** $11.9M | **Employees:** 7
- **Owner since 2005, in HVAC since 1979**
- Apollo ID: `66f25d80cbd49700019d0861`

### Prospect 2: Plumbing Company Owner — Arlington, TX
- **Company:** J Rowe Plumbing
- **Employees:** 5 | **In business since 1984**
- Apollo ID: `66fc918cf037a60001d37cb1`

### Prospect 3: Dentist/Owner — Louisville, KY
- **Company:** Stony Brook Dental Care
- **Dentist/Owner since 2002**
- Apollo ID: `66f21fda16ff4a00011271f4`

---

## Email Template: HVAC / Mechanical

**Subject:** Friday night no-heat calls at {company}

**Body:**

{first_name} —

Quick question: what happens when someone calls {company} at 9pm on a Friday with no heat?

If it's going to voicemail, you're probably losing 2-3 emergency jobs a month to whoever picks up first. At your average ticket size, that's $5,000-10,000/year walking away.

We built an AI that answers your phone when you can't — gets the caller's info, asks what the issue is, and texts your on-call tech the details. Takes about 15 minutes to set up.

Would it be useful if I showed you a 2-minute demo of how it handles an HVAC emergency call?

{sender_name}
Milo — getmilo.dev

P.S. {personalized_closer}

---

## Email Template: Plumbing

**Subject:** After-hours calls at {company}

**Body:**

{first_name} —

Running a {employee_count}-person plumbing shop means you're probably on a job site when half your calls come in. And most people who hit voicemail don't leave a message — they just call the next plumber on Google.

We built an AI that answers when you can't. It sounds like a real person, gets the caller's name and what they need, and texts you a summary. You call them back within the hour with full context.

{company}'s been around since {founded_year} — {years_in_business} years of reputation shouldn't be undermined by a missed call. This costs $49/mo and takes 15 minutes to set up.

Want me to send you a quick demo?

{sender_name}
Milo — getmilo.dev

---

## Email Template: Dental

**Subject:** Patient calls at {company}

**Body:**

Dr. {last_name} —

Here's a stat that probably won't surprise you: about 60% of patients who call a dental office and don't get through won't call back. They'll just book with whoever picks up.

We built an AI receptionist specifically for dental practices. It answers your phone when your front desk is busy or after hours, confirms your business hours, answers common questions ("do you take Delta Dental?"), and captures the patient's info so your team can follow up.

{company}'s been serving {city} for over {years_in_business} years — this just makes sure no new patient slips through the cracks. It's $49/mo and takes about 15 minutes to set up.

Would a quick 2-minute demo be useful?

{sender_name}
Milo — getmilo.dev

---

## Scaling Plan

### Week 1: Test (3 emails)
- Send the 3 personalized emails to prospects above
- Monitor: deliverability, open rates, replies
- Iterate on subject lines and copy based on results

### Week 2: Small batch (10/day)
- Enrich 50 more prospects (mix of HVAC, plumbing, dental)
- A/B test 2 subject line variants
- Monitor bounce rate, spam complaints

### Week 3: Scale (25/day)
- If Week 2 shows <2% bounce rate and >20% open rate, increase volume
- Add electrical, landscaping, and general contractor verticals
- Begin segmenting by company size and region

### Week 4: Full pipeline (50/day)
- 3-email sequence: initial outreach, follow-up (day 3), last chance (day 7)
- Target: 1,000 prospects/month, 2-3% reply rate = 20-30 conversations

## Expected Outcomes
- **Test batch (3):** Validate deliverability and message-market fit
- **Month 1 (500 emails):** 10-15 replies, 3-5 demos, 1-2 customers
- **Month 2+ (1,000/month):** 20-30 replies, 6-10 demos, 2-4 customers/month

## Cost
- Apollo.io: Free tier (50K daily credits, sufficient for this volume)
- Resend: Free tier (3,000 emails/month)
- Total additional monthly cost: $0
