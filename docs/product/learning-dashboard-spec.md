# Learning Dashboard — Specification

**Status:** design only. **Not to be implemented before G1** (see backlog: "Depends on G1").
**Purpose:** turn every concierge interaction, interview, and experiment into a visible change in
company knowledge — so that learning velocity, the scarce resource, becomes measurable rather than
felt.

The existing assumption dashboard answers *"what do we believe and how sure are we?"* This one
answers *"what did we learn this week, and is the rate accelerating or decaying?"* They are
complementary; this one subsumes and extends the first.

---

## 1. Non-goals (stated first, because dashboards die of scope)

- **Not** a product-analytics tool. No funnels for features that don't exist yet.
- **Not** a real-time system. Weekly cadence with a daily refresh is correct; anything faster
  invites reacting to noise at n=25.
- **Not** a vanity board. Every panel must be capable of showing bad news clearly. A panel that can
  only look good is decoration.
- **Not** automated at the start. During P0 the inputs are a spreadsheet and a founder's notes; the
  dashboard's first job is to make manual data legible, not to eliminate it.

## 2. Audience and cadence

| Audience | When | What they need |
|---|---|---|
| Founder | Before every planning meeting; Monday review | What moved, what's stale, what to do this week |
| Ops operator | Daily during P0 | Which households are silent, which probes are unanswered |
| Future engineers | At each gate | Which assumptions their work is retiring |
| Investors | At gates only | Cohort curves and evidence quality, not screenshots of activity |

## 3. Data sources

| Source | Nature | Owner | Automation phase |
|---|---|---|---|
| `ops/assumptions.yaml` | Structured, versioned | CTO | Available now — read directly |
| Concierge events sheet (`date · household · event · notes`) | Manual, high fidelity | OPS | Phase 1: CSV export; Phase 2: replaced by product telemetry |
| Interview scoring sheet (rubric from `ops/p0/interview-guide.md`) | Manual, one row per interview | Founder | Phase 1: CSV; stays manual — interviews are not telemetry |
| Landing-page analytics (`lp_view`, `waitlist_submit`, `price_shown`, `card_intent_click`) | Automatic | Founder | Phase 1 |
| Concierge ledger spreadsheet (items/obligations per household) | Manual | OPS | Phase 2: superseded by the real ledger |
| Product telemetry (post-alpha) | Automatic | CTO | Phase 3 |

**Design constraint:** the dashboard must produce every panel from Phase-1 sources alone. If a panel
requires product telemetry to exist, it is a Phase-3 panel and is drawn greyed-out with "awaiting
alpha" rather than omitted — visible absence beats invisible absence.

## 4. Panels

### 4.1 Assumption confidence (the spine)
- Per-assumption confidence over time as a small multiple: 15 sparklines, colored by category, with
  the two existential ones (H1, H2) rendered at double size at the top.
- Each shows: confidence trajectory, status chip, days-since-last-evidence, next-evidence-due.
- **The signal that matters:** flat lines. A flat line on an existential assumption for 14+ days is
  the dashboard's loudest alarm — it means the week's work touched nothing that matters.
- Derived from `assumptions.yaml` history (requires committing the YAML on every update — git *is*
  the time series; no separate store).

### 4.2 Interview insights
- Segment comparison table: caregiver / visa-holder / generalist × the rubric dimensions
  (pain severity, frequency, current spend, workaround effort, WTP signal, commitment, access).
- Running mean + n per cell, with a "decision-ready?" indicator at n≥20 per segment.
- **Verbatim wall:** the copy-harvest quotes, filterable by segment and theme. This is the panel the
  landing-page copy gets rewritten from; it is a working surface, not a display.
- Wedge-decision readout: the pre-written rule (mean pain × commitment rate, tie-break on access)
  computed live, so the wedge choice is arithmetic rather than argument.

### 4.3 Concierge metrics
- Cohort table, one row per household: week joined, docs forwarded per week (sparkline), reminders
  sent/actioned, corrections made, found-value logged, last contact.
- Silence detector: households with no inbound for 10+ days, ranked — the operator's daily worklist.
- Effort economics: minutes per document and minutes per household per week, trended. This prices
  what automation is worth and feeds the COGS model (H14).
- Surprise counter: obligations discovered that the household did not know about. **This is the
  product's core moment**; if it trends toward zero after onboarding, the value proposition is
  front-loaded and retention will fail.

### 4.4 Retention
- Week-N ingestion retention curve (the G1/G3 gate metric), plotted per segment with the kill
  threshold drawn as a horizontal line on the chart. A threshold you can see is a threshold you
  cannot quietly move.
- Second curve: reminder-response retention (do they still engage with probes at week 8?) — the
  early proxy for H11's self-maintaining ledger.
- Cohort triangle once n permits; until then, explicit "n too small" rather than a smooth lie.

### 4.5 Willingness to pay
- Landing-page card-intent by (message variant × price point), with confidence intervals wide enough
  to be honest at low n.
- Concierge conversion funnel: onboarded → active at day 30 → asked → gave card.
- Van Westendorp band from interviews (too cheap / bargain / expensive / too expensive).
- **Cross-check panel:** stated WTP from interviews vs. observed card-intent, side by side. The gap
  between them is itself a finding, and it is the number most likely to be self-flattering.

### 4.6 Evidence quality
The panel that keeps the rest honest. Every evidence entry is graded:

| Grade | Criteria | Example |
|---|---|---|
| **A** | Behavioral or paid, n≥20, from a representative sample | 25 households' week-3 forwarding rates |
| **B** | Behavioral or paid, n<20; or stated intent with n≥20 | 8 households' card conversions |
| **C** | Stated intent n<20; or expert judgment | Interview WTP claims; panel opinion |
| **D** | Secondary research, precedent, or our own prior reasoning | Competitor pricing; the graveyard analysis |

Displays: distribution of grades supporting each assumption; **an assumption whose highest grade is
C or D is flagged as "unsupported" regardless of stated confidence**; and a portfolio trend — the
share of A/B evidence should rise every month or the company is theorizing rather than learning.

### 4.7 Open risks
- The risk register (R1–R9 from the execution blueprint) with current state, owner, and the gate
  that retires each.
- Failure-metric watch (PRD X1–X7) with current values and red-line distance.
- Incumbent watch: dated log of competitor moves, with the H15 clock.
- Stale-assumption list: anything untouched for 60+ days.

## 5. Metric definitions

Precise enough that two people compute the same number.

| Metric | Definition |
|---|---|
| Week-N ingestion retention | Households with ≥1 inbound document in week N ÷ households onboarded ≥N weeks ago. Denominator excludes households onboarded less than N weeks ago; forwarded and uploaded both count; a reply with no attachment does not. |
| Reminder action rate | Critical (priority-1) reminders marked resolved within 14 days ÷ critical reminders sent, excluding those sent in the last 14 days. |
| Surprise rate | Obligations created that the household did not name during census ÷ total obligations created, per household. |
| Effort per document | Operator minutes logged ÷ documents processed, weekly median (median not mean — one 45-minute nightmare document should not move the number). |
| Card-intent rate | Distinct visitors clicking the payment link ÷ visitors shown a price. Not a charge. |
| Concierge conversion | Households giving a card at day 30 ÷ households still active at day 30. Reported alongside "÷ households onboarded" so churn is not hidden in the denominator. |
| Evidence portfolio | Share of registry evidence entries graded A or B. |
| Learning velocity | Count of evidence entries added per week, weighted by grade (A=4, B=3, C=2, D=1), plotted against the flat-line alarm from §4.1. |
| Freshness (post-alpha) | Ledger facts with `verified_at` within 12 months ÷ total facts. |

## 6. Information architecture

Single scrolling page, weekly-review shaped, in decision order:

```
[ Header: week of · days to next gate · one-line verdict ]
[ 1. Existential pair — H1, H2, oversized, with kill lines ]
[ 2. What moved this week — evidence drops with grades ]
[ 3. Retention curves · 4. WTP cross-check ]
[ 5. Concierge cohort table + silence detector ]
[ 6. Interview segments + verdict arithmetic ]
[ 7. Evidence quality portfolio ]
[ 8. Open risks · stale assumptions · incumbent log ]
[ Footer: the three planning-meeting questions ]
```

Design rules: bad news renders in the same visual weight as good news; every number carries its `n`;
every threshold is drawn, not described; panels awaiting later phases are visible and greyed.

## 7. Update pipeline (phased)

**Phase 1 — during P0 (manual, ~2 hours to build when authorized).** Static page generated by a
script from: `assumptions.yaml` (committed history), a concierge CSV, an interview CSV, and an
analytics export. Regenerated weekly, published like the current dashboard. No database, no service.

**Phase 2 — during alpha.** Concierge sheet replaced by queries against the real ledger; assumption
history read from git; interviews stay manual.

**Phase 3 — post-launch.** Product telemetry replaces manual counts; the dashboard becomes a
scheduled job. Learning velocity and evidence portfolio remain the headline metrics — the panels
that made the company think clearly at n=25 are the ones worth keeping at n=25,000.

## 8. Acceptance criteria (for whenever it is built)

- Regenerates from source data with one command, with no manual editing of the output.
- Renders correctly with zero interviews, zero households, and zero evidence — the empty state is
  the first thing tested, because that is the state it launches in.
- Every panel displays `n` and refuses to draw a trend below its stated minimum.
- Kill thresholds are drawn on the charts they gate.
- Loads in under two seconds and prints legibly on one page for offline review.
- Contains no personally identifying information about concierge households — pseudonymous IDs only,
  consistent with the principle that operational tooling holds no more PII than it needs.
