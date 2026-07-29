# P0 Landing Pages — Message × Price Test

**Instrument, not product.** Three single-page variants on any no-code builder + Stripe payment links; a real domain, real analytics, real card-intent. Traffic: $500–1,000 total across segment-targeted channels (caregiver FB/IG, immigration subreddit sponsorships, generic broad) — enough for directional read, not significance theater. Success metric: **waitlist conversion** and, stronger, **card-intent click-through** per variant.

## Variant A — Fear ("never miss")
- **H1:** "Nothing in your family's paperwork lapses. Ever."
- **Sub:** AutoBureau watches every renewal, deadline, and expiry across your household — and tells you exactly what to do, with time to do it.
- Proof block: "The average household tracks 30+ deadlines from memory. One miss costs $200–$2,000."
- CTA: *Get early access*

## Variant B — Greed ("found money")
- **H1:** "Your household is owed money it will never collect. We find it."
- **Sub:** Forgotten warranties, refundable deposits, subscriptions you stopped using, claims you never filed — AutoBureau tracks what you're owed, not just what you owe.
- Proof block: "$1,800 security deposit. $340/yr of zombie subscriptions. A warranty that covered the repair you paid for."
- CTA: *See what you're missing*

## Variant C — Relief (caregiver register)
- **H1:** "Your parents' paperwork, finally under control."
- **Sub:** When you're the one holding it all together, AutoBureau holds it with you — every policy, renewal, and deadline for the whole family, in one place that never forgets.
- Proof block: testimonial-shaped (from concierge cohort, with permission, week 3+).
- CTA: *Get help now*

## Price grid (shown on the waitlist confirm step, per-visitor randomized)
$6/mo · $12/mo · $99/yr — measure card-intent click ("reserve your spot — first month free") per price. The click on a real Stripe link is the datum; the charge is $0.

## Mechanics
- Footer: honest "early access — currently human-powered concierge" line (no fake-AI claims; trust category, trust rules).
- Events: `lp_view{variant}` · `waitlist_submit{variant, segment_source}` · `price_shown{point}` · `card_intent_click{variant, price}`.
- Week-3 revision: rewrite all three from the interview verbatim file; re-run. The *delta* between our copy and their copy is itself a finding.
- Decision feed: winning message → PRD §15 register; winning price → F14 (via §4.1/§21 clause if it moves).
