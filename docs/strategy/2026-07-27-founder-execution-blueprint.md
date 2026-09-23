# AutoBureau — Founder Execution Blueprint (12 Months)

**Date:** 2026-07-27 · **Horizon:** Month 0 (now) → Month 12
**Inputs:** architecture v0.2.0-review · Series-A red-team (A-B1..6) · first-principles ledger thesis (A-F1..5)
**Organizing rule:** every workstream is tagged with the existential risk it retires (R-register below). Work that retires no risk is deferred, however fun. Features are a *means* of risk retirement, never a goal.
**Team assumption at M0:** founder + contractors; seed capital not yet raised. If reality differs, gates hold and dates compress/stretch.

---

## 0. The risk register (the spine of the plan)

| ID | Existential risk | Retired by | Deadline to know |
|----|------------------|-----------|------------------|
| R1 | **Behavior:** users won't feed the ledger (ingestion labor) | P0 concierge + friction tests; later inbox OAuth | Month 1 (first read), Month 7 (confirmed) |
| R2 | **Monetization:** willingness-to-pay < viability | P0 pricing tests; P3 real conversion | Month 1 / Month 7 |
| R3 | **Trust/accuracy:** one wrong obligation destroys the premise | eval harness + review queue + per-field thresholds | Month 5, then forever |
| R4 | **Reliability:** a missed critical reminder that mattered | reminder SLO engineering + monitoring (doc 08/10) | Month 8, then forever |
| R5 | **Security:** breach of the honeypot = company over | posture ladder: keel → pen test → insurance → audits | Standing; hard gate Month 8 |
| R6 | **Distribution:** no channel where CAC < LTV | wedge choice + channel experiments + found-money loop | Month 9–12 |
| R7 | **Speed:** incumbent ships the feature before we own the workflow | scope discipline (§18 cuts) + rulebook head start | Standing |
| R8 | **Capacity:** founder burn-out / wrong hires / cash-out | hiring order §6, budget §8, default-alive rule | Standing |
| R9 | **Regulatory:** OAuth scope audits, marketing-claims liability, privacy patchwork | legal checkpoints §7 | Before each triggering feature |

Priority order when workstreams collide: **R5 ≥ R3 ≥ R4 > R1 ≥ R2 > R6 > everything else.** (Security and trust failures are irreversible; demand failures are merely fatal.)

---

## 1. Phase P0 — Validation Sprint (Weeks 1–4) · *retires first reads on R1, R2*

**Rule in force: zero production code.** The architecture repo stays closed except for docs.

| Workstream | Detail | Owner |
|---|---|---|
| Concierge MVP (R1, R2, R3) | 25 households, recruited across the three wedge candidates. Real service, delivered manually: shared inbox, spreadsheet-ledger, human-sent reminders, human-drafted cancellation letters. Instrument *everything*: docs forwarded per week, response-to-reminder rate, corrections needed | Founder + contract ops operator (Hire #0) |
| Ingestion-friction test (R1) | 50 recruits: set up forwarding + send 10 documents. Measure unaided completion | Ops |
| Wedge interviews (R6) | 25 caregivers (sandwich generation) · 25 visa/green-card holders · 25 generalist household CFOs. Structured guide; record WTP signals, current workarounds, emotional language for copy | Founder personally — non-delegable |
| Pricing/message split test (R2, R6) | 3 landing pages (fear: "never miss a deadline" / greed: "we find money you're wasting" / relief: "your family's paperwork, handled") × ($6, $12, $79/yr). Waitlist conversion + card-intent test | Contract designer + founder |
| Rulebook feasibility spike (R7) | Hand-build complete obligation rules: 3 states × DMV + 10 insurers + 20 subscription vendors. Measure hours/vendor → prices the Ledger-B moat | Ops + founder |

### Gate G1 (end of Week 4) — the first kill-or-pivot point
- **KILL the current shape if:** <40% of concierge households still forwarding documents in week 3 **and** <25% say yes to a real card at $8–12/mo **and** no wedge shows differentiated pull. Outcome: shelve or hard-pivot (B2B2C-first, or found-money-only product); return unspent capital honestly if raised.
- **RE-ROLL (one allowed):** one wedge shows pull but the tested shape doesn't → 4 more weeks of concierge focused solely on that wedge.
- **PROCEED if:** ≥1 wedge with ≥50% week-3 forwarding retention and ≥25% card-intent. Wedge is thereby **chosen by data**; horizontal ambitions go back in the drawer until Act II.

---

## 2. Phase P1 — Foundation (Months 2–3) · *retires R8 (capital, team), sets up R3/R5*

Concierge cohort **continues throughout** — it is the retention instrument (the curve investors will ask for) and later the QA layer. Do not disband it to "focus on building."

**Company & capital (R8):** incorporate cleanly (DE C-corp, standard stack, IP assignment); raise **seed $2.5–4M** on G1 evidence (deck = G1 data + ledger thesis + this blueprint; target 20–24 mo runway). Per the red-team: this is a seed story until a retention curve exists — do not chase the $20M A.
**Decisions locked (founder, week 5):** wedge; accept/amend A-B1–6 and A-F1–5; pricing hypothesis for beta; geography (US) ; buy `autobureau.com` + `in.autobureau.com`; monetization-stance ADR-011 drafted (subscription-first, found-money share reserved, **no referral/affiliate in year 1**).
**Docs updated (1 week, not 4):** apply accepted A-B/A-F deltas to the architecture set → v0.3.0-final; ADRs flip to *Accepted*.
**Engineering begins — walking skeleton only (R3, R5 foundations):** contracts package + CI gates (incl. gitleaks/CodeQL from commit one) → scoped DB client with the A1 `$transaction`/`SET LOCAL` pattern + RLS tests → outbox + dispatcher + one worker → **one end-to-end thread: upload → classify → extract → obligation → reminder email**, with audit log and eval harness v0 (50 fixtures from concierge documents, already labeled by real corrections). Schema ships with `obligations.direction` (A-F2) and outcome-capture fields (A-F3) from day one.
**Hiring:** #1 founding engineer (full-stack TS) starts M2; #2 founding engineer (Python, pipeline/evals) starts M3.

**Exit criteria (end M3):** skeleton thread works in staging with real concierge documents; eval harness runs in CI; seed closed or term sheet signed; concierge cohort ≥ 20 active with week-10 retention data.

---

## 3. Phase P2 — Private Alpha (Months 4–5) · *retires R3 (first real test), R1 (software-assisted)*

**Product:** migrate the concierge cohort onto the software — they are alpha users with a human safety net (ops staff behind the review queue, Wizard-of-Oz where the pipeline fails). Scope = the §18-cut MVP: 8 obligation-bearing doc types · registry · obligations inbox · reminder ladders · weekly digest · review queue (staff + user modes — A-B5) · search box (no chat) · template-based drafts (no agent).
**Ledger discipline (A-F1/F3):** every resolution captures outcome; freshness (`verified_at`) tracked from the first row; coverage measured against an onboarding census ("list what you think you hold" → measure what % the system captures within 30 days).
**Rulebook (R7, A-B2/A-F4):** rulebook ops tooling v0; wedge-relevant coverage first (chosen wedge's states/vendors). Hire #3: **rulebook/content ops lead** (M4) — the moat is content; staff it like engineering.
**Eval ramp (R3):** corpus to 300+ via concierge corrections; per-field auto-apply thresholds derived (doc 11 §2.4); **nothing auto-applies until its field clears the 99%-precision bar** — until then, everything routes through review (ops absorbs the load; that's what the concierge muscle is for).

### Gate G2 (end M5) — quality gate
- **Green:** coverage ≥ 70% of censused items within 30 days · AI-proposal accept rate ≥ 85% · time-to-first-true-obligation < 10 min (A-B4) · alpha households doing ≥ 1 meaningful session/week without prompting.
- **Red (any):** accept rate < 75% after two tuning cycles → **pivot decision**: ship as human-verified service (ops-heavy, higher price, lower margin) rather than AI-confident product — and re-cost the business accordingly. Coverage < 50% → ingestion is broken → inbox OAuth jumps the queue (build it before beta, accept the CASA cost early).

---

## 4. Phase P3 — Closed Beta (Months 6–7) · *retires R1 (passive ingestion), R2 (real money)*

**Inbox OAuth (A-B1, R1, R9):** build Gmail read-only ingestion. **Legal checkpoint precedes code:** Google verification plan + CASA assessment budgeted and scheduled (lead times are months — start the paperwork in M5). Outlook follows post-launch. Forwarding remains the fallback channel.
**Billing (R2):** Stripe live; beta cohort (waitlist from P0 landing pages, 150–300 households) pays real money at the tested price from week one of beta — free betas teach nothing about R2. Annual option offered; **cancellation is one click** (FTC posture + brand).
**Entitlements v0 (ledger thesis, R6 seed):** warranty windows + deposit tracking + "recurring items noticed" — the first "AutoBureau found/protected $X" moments, instrumented as the shareable artifact.
**Trust surfaces (R5→adoption):** security page written for humans; "what we can/can't see" explainer; progressive-sensitivity onboarding (receipts before passports).

### Gate G3 (end M7) — economics gate
- **Green:** week-8 ingestion retention ≥ 50% (OAuth households ≥ 70%) · waitlist→paid ≥ 8% · M1 paid logo churn ≤ 6% · accept rate holding ≥ 88% at growing volume · OAuth activation ≥ 60% of new signups.
- **Yellow:** conversion 4–8% → pricing/packaging iteration (one 6-week cycle) before launch.
- **Red:** week-8 retention < 40% *with* OAuth live → the behavior thesis itself is failing → **pivot point**: B2B2C distribution (employer/insurer pays, consumer uses) or found-money-only repositioning. This is the last cheap pivot; after launch, pivots cost brand.

---

## 5. Phase P4 — Launch (Months 8–9) · *retires R4, R5 to launch-grade*

**Security hard gate (R5), all before public availability:** external pen test + remediation · cyber-liability insurance bound · IR tabletop executed · secrets/access audit · DSR flows (export + deletion) tested end-to-end · vendor DPAs countersigned.
**Reliability hard gate (R4):** reminder SLO (99.5% within 5 min) demonstrated over 30 consecutive days in beta · deliverability warmed (DMARC ramp, suppression handling) · missed-critical-reminder postmortem process live · status page public.
**Quality gate (R3):** classify ≥ 97% · date fields ≥ 0.98 · zero injection-canary breaches · auto-apply live only for fields that earned it.
**Legal (R9):** ToS/privacy final (reliance disclaimers reviewed by counsel — *and* marketing claims audited against them: "never miss" language is a lawsuit, "we watch so you don't have to" is a brand) · state-privacy-law compliance check · 16+ gate.
**Launch motion (R6):** wedge-native, not TechCrunch-generic: the free tool funnel (passport-expiry checker / state renewal calculators — SEO assets built during P3 idle cycles), community launch in the wedge (caregiver forums / immigration communities), founder-story content, referral loop v0 ("give a month, get a month"). Paid acquisition **off** until organic baseline is read.
**Hire #4 (M8):** fractional security engineer (owns pen-test remediation + posture). **Hire #5 (M9):** growth generalist.

### Gate G4 — launch readiness is a checklist, not a vibe
Every item above green, plus: support runbooks + staffing plan (ops team = support team) · unit-economics dashboard live (COGS/household tracking vs the ~$1.10 model) · one-click data export working (the trust wedge, A-F5). Any red item delays launch — a bad launch in a trust category is not recoverable by iteration.

---

## 6. Phase P5 — Prove the Engine (Months 10–12) · *retires R6 to fundable; sets up Series A*

**Growth:** read organic channels 4 weeks → scale the one with CAC < $60 · referral loop v1 · recovered-value stories as content engine · begin paid tests only where LTV math clears 3:1 on *observed* retention.
**Product (asset metrics, not features):** coverage/freshness improvements ranked by dashboard impact · entitlements v1 (the found-money loop earns its own workstream if G3 data supports) · first *resolution rails* pilot (one vendor category end-to-end, e.g. subscription cancellation execution) — the Act-II seed and the Ledger-B ignition (outcome capture finally gets execution data).
**Fundraising Gate G5 (M12):** raise the Series A only if: paying households ≥ 1,500 · M3 paid logo retention ≥ 85% (monthly churn ≤ 5%) · W8 ingestion retention ≥ 55% · LTV:CAC ≥ 3 with < 12-mo payback on the scaled channel · accept rate ≥ 90% · recovered-value per household measurable. **If not met:** do not raise into weakness — cut to default-alive (burn ≤ revenue + 18 mo runway), keep the concierge/ops muscle, iterate the wedge. The ledger thesis is explicitly a compounding story; a flat year that keeps tenure accruing is survivable, a desperate raise is not.

---

## 7. Standing tracks (never phase-gated)

| Track | Cadence | Content |
|---|---|---|
| **Trust ledger (R3/R4)** | weekly | accept-rate by doc type · missed-reminder count (target: 0) · every false obligation gets a five-whys |
| **Security posture (R5)** | monthly | access review · dependency SLA compliance · quarterly restore drill · canary-corpus growth (named owner) |
| **Incumbent watch (R7)** | monthly | Google/Apple/OpenAI/Rocket feature scans (live research, not vibes). **Pre-written response playbook:** if Google ships renewal-tracking → accelerate resolution rails + cross-provider + trust positioning; do *not* panic-pivot — reminders were never the moat |
| **Rulebook coverage (moat)** | weekly | vendors × regions verified · hours/vendor trend · outcome-confirmation rate |
| **Founder discipline (R8)** | monthly | burn vs plan · runway ≥ 12 mo or corrective action · the "are we building features or retiring risks?" review of the sprint board |
| **Kill-switch honesty** | quarterly | re-read the G-gate thresholds *as written at M0* — moving goalposts is the founder failure mode this document exists to prevent |

## 8. Hiring order (each hire tagged to the risk it retires)

| # | When | Role | Risk | Note |
|---|------|------|------|------|
| 0 | Week 1 | Contract ops/concierge operator | R1/R2 | Runs the validation instrument; becomes ops lead if G1 passes |
| 1 | M2 | Founding engineer — full-stack TS | R8 | Owns web/domain; hire for judgment + speed, not scale résumés |
| 2 | M3 | Founding engineer — Python/pipeline/evals | R3 | Owns extraction + eval harness |
| 3 | M4 | Rulebook/content ops lead | R7 (moat) | The most non-obvious hire on this list; make it anyway |
| 4 | M8 | Fractional security engineer | R5 | Scales to full-time post-A |
| 5 | M9 | Growth generalist | R6 | Only after launch signal exists |
| — | Deferred to post-A | PM, sales, designer-FTE, engineers 3+ | — | Design stays contract; founder is PM; B2B2C conversations are founder-led with LOIs only |

## 9. Budget envelope (seed $3M reference case)

Burn ramp ≈ $45k/mo (P0–P1, mostly people-light) → $110k/mo (P2–P4, 5 people + infra + one-off security/legal: pen test ~$30k, CASA ~$15–50k, insurance, counsel ~$40k across the year) → $140k/mo (P5). Total year-one ≈ $1.15–1.3M → **>20 months runway** at close. COGS guarded by the entitlement caps + gateway budgets (A-B3/A-B8 lineage); the unit-economics dashboard is a launch criterion, not a someday.

## 10. The one-page version (print this)

```
W1–4    Concierge + interviews + pricing tests. No code.        → G1: kill / re-roll / proceed (wedge chosen by data)
M2–3    Incorporate, raise seed on G1 data, lock decisions,
        walking skeleton (one true thread), hire eng #1–2.
M4–5    Alpha = concierge cohort on software. 8 doc types,
        review queue, evals ramp, rulebook ops hire.            → G2: accuracy/coverage or pivot to human-verified
M6–7    Closed paid beta. Inbox OAuth (+CASA started early),
        Stripe, entitlements v0, trust surfaces.                → G3: retention/conversion or pivot to B2B2C / found-money
M8–9    Security+reliability hard gates, then wedge-native
        launch. Free-tool SEO funnel. No paid ads yet.          → G4: checklist launch, delay if any red
M10–12  Read channels, scale one, resolution-rails pilot,
        entitlements v1.                                        → G5: raise A on metrics, or default-alive. Never raise into weakness.
```

**The blueprint's contract with the founder:** gates are written down now, while nobody's ego is invested in the answer. The company earns each next phase by retiring a risk, not by shipping a feature. If month 12 arrives with G5 green, you have a Series A company *and* the beginning of a ledger no one can copy. If it arrives red, you'll know precisely why, precisely when you learned it, and you'll have spent a seed — not a Series A and four years — finding out.
