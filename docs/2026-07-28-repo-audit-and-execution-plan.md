# Repository Health Audit & Four-Week Execution Plan

**Date:** 2026-07-28 · **Role:** TPM + Founding CTO · **Objective for the next four weeks:**
maximize validated learning on H1 (ingestion behavior) and H2 (willingness to pay). Nothing else
qualifies as work.

---

# Part I — Repository Health Audit

**Scope:** 40 markdown documents, 3 workspace packages, 12 integration tests, CI, and the governing
document set. **Verdict: structurally sound, with one dangerous defect and a cluster of stale
claims — all now fixed.** The repository's biggest risk was not complexity; it was documents that
had quietly become false.

## A. Fixed during this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| A1 | **High (security-adjacent)** | `.env.example` set `DATABASE_URL` to the `autobureau` superuser. Any developer copying it would run with **row-level security silently inert** — the app appears to work perfectly while tenant isolation does nothing. This is blocker F-01 re-entering through documentation, which is exactly how a fixed bug comes back. | Rewritten with two clearly-separated connections and an explanation of why the distinction is load-bearing. |
| A2 | **High (governance)** | All eight ADRs read `Status: Proposed` while five of them were already implemented in shipped code. Building against "proposed" decisions means no decision was ever actually made. | Flipped to `Accepted`, each annotated *implemented* or *not yet implemented*. Index table updated to match. |
| A3 | **High (staleness)** | `README.md` — the front door — declared `Status: ARCHITECTURE_REVIEW · no production code exists yet, by design`. False. It also documented a "planned" layout of six directories, four of which do not exist and are deliberately gated. | Rewritten: current status, a "start here" routing table, and a layout showing what exists versus what is gated and why. |
| A4 | Medium | `docs/architecture/README.md` said "awaiting founder sign-off" and carried a rule forbidding implementation. | Marked ACCEPTED and frozen; the implementation rule now correctly points at the G1 product gate instead. |
| A5 | Medium (contradiction) | Architecture docs 04 and 11 referenced "~25 doc types at launch"; the PRD froze **8**. A reader of doc 04 alone would build the wrong scope. | Both corrected inline, with the superseding source named. |
| A6 | Medium (duplication) | `CLAUDE.md` carried its own list of 7 invariants; `FOUNDING_PRINCIPLES.md` §7 has 10. Two lists, different counts, neither marked authoritative. | `CLAUDE.md` now points at the constitution as binding and keeps only the codebase-specific operational notes. |
| A7 | Medium (duplicate state) | `ops/dashboard.html` hardcodes the full register, which became duplicate state the moment `assumptions.yaml` was made source of truth — drift I introduced myself. | Banner added: hand-maintained snapshot, YAML wins on conflict, generator deferred to the learning dashboard. |
| A8 | Low (traceability gap) | Six artifacts were untraced: `.env.example`, `ops/p0/*`, `ops/dashboard.html`, and the two new product documents. | Rows added to `docs/TRACEABILITY.md`. |

Regression check after all edits: build, typecheck, 49 unit tests, 12 integration tests — green.

## B. Residual findings — accepted, not fixed

| # | Finding | Why it stays |
|---|---|---|
| B1 | **Postgres version drift**: compose and CI pin pg16; the verified local run used pg18. | Genuine, already tracked as backlog item Z1. Fixing it is engineering work, correctly scheduled there rather than done ad hoc during an audit. |
| B2 | Architecture doc 04 still describes chat and agent workflows in its inventory. | Correct as written — the architecture is *reviewed and parked*, and the PRD is authoritative on scope. The CI scope fence prevents the tables from reappearing. Rewriting doc 04 would destroy work we intend to use in Act II. |
| B3 | Pricing appears as `$12` (PRD), `$8–12` (registry, blueprint), and `$4–8` (red-team's challenge). | Not a contradiction — different roles. The PRD is the current provisional decision; the registry records the band under test; the red-team records the objection. H2's whole purpose is to resolve this. |
| B4 | `ops/assumption-ledger.md` is 93 lines carrying ~40 lines of content after the register moved to YAML. | Cosmetic. Merging it into the YAML header would cost more attention than it saves. |
| B5 | Doc 02 says the Prisma schema is generated "from this document"; in practice `schema.prisma` is now authoritative for the database. | Harmless while the two agree, and they do. Worth a note the next time doc 02 is edited for another reason. |

## C. Explicitly checked and found healthy

- **No duplicate documents.** Every document has a distinct job; overlaps (constitution vs. guardrails, ledger vs. registry) are now hierarchical rather than parallel.
- **No architectural drift in code.** Schema matches doc 02 as amended; no vector index (A3); postponed tables absent; scoped client matches A1; outbox matches ADR-005. Verified by query, not by reading.
- **No unnecessary complexity.** Three packages, one of which is a YAML file with a validator. Nothing to delete.
- **Traceability is complete** after A8: every artifact maps to a decision, and the "absent by decision" table answers the harder question.

---

# Part II — Four-Week Execution Plan

**The only two questions that matter:** will households feed the ledger (H1), and will they pay
(H2)? Both are existential, both are at low confidence, and both resolve at G1 on ~2026-08-25.

## The scheduling fact that drives everything

The kill threshold is **week-3 forwarding retention**. For that measurement to exist inside the
four-week window, **every household must be onboarded by day 12.** Onboarding that slips to week
three does not produce a late answer — it produces *no answer*, and G1 slips with it.

Working backwards: 25 onboarded households, at roughly 50% screen-to-onboard and 30%
outreach-to-screen, requires **~50 screening conversations from ~170 outreach touches, starting
this week.**

## Priority 0 — Do these in the next 72 hours

| # | Action | Why it is P0 |
|---|---|---|
| P0-1 | **Hire the ops operator** (contract, part-time is fine) | The binding constraint. Running the concierge service is ~25 hours/week by week 2; the founder cannot both operate the service and conduct 50 conversations. Every day of delay compounds into the founder doing both badly. |
| P0-2 | **Send the first 60 outreach messages** | The funnel is the critical path and it has a multi-day response latency. Outreach volume today is onboarding capacity on day 12. |
| P0-3 | **Merge the interview guide into the screening call** | 30 minutes of founder time currently produces *either* a recruiting decision *or* a wedge datum. Merged, it produces both. This single change is what makes 50 conversations feasible instead of 125. |
| P0-4 | **Landing pages live with the three message variants and price grid** | H2's only instrument that runs while the founder sleeps. It needs two weeks of traffic to say anything. |
| P0-5 | **Service inbox + household ledger spreadsheet + events sheet** | The measurement apparatus. A week of service delivered without instrumentation is a week of unrecorded evidence. |

## Week-by-week

### Week 1 (Jul 28 – Aug 3) — Fill the funnel, instrument everything
- **Founder:** 170 outreach touches (batched, templated); 20–25 merged screening/interview calls;
  landing pages live; ops operator hired and trained on the playbook.
- **Engineering (me, ~2 days, does not compete for founder attention):** Tier 1 zero-regret only —
  Postgres version parity, PII log redaction, DST-safe scheduling primitives, test fixture factory,
  CI completeness. Then stop.
- **Exit condition:** ≥30 households screened, ≥12 onboarded, landing pages taking traffic.

### Week 2 (Aug 4 – 10) — Onboard to 25 and start the service
- Complete onboarding to 25 by **day 12** (hard date — see above).
- First weekly digests go out; reminder ladders begin; every interaction logged.
- **First H1 signal appears:** week-1 forwarding counts by segment.
- Founder continues merged calls to ~40 cumulative.
- **Checkpoint (Aug 10):** if fewer than 18 households are onboarded, that is itself a finding about
  reachability. Response is documented in advance: extend the sprint by one week rather than
  proceed on thin data, and record the recruiting difficulty as evidence against H3's `access`
  dimension.

### Week 3 (Aug 11 – 17) — The measurement week
- **This is where H1 is decided.** Week-3 forwarding retention against the 40% kill line.
- Reminder response rates begin testing H11 (reminders as freshness probes).
- Found-value hunts run: one per household per fortnight, logged with dollar values — the H9
  instrument and the shareable-moment test.
- Landing-page copy rewritten from interview verbatims and re-run — the delta between our language
  and theirs is itself a finding.
- Founder completes remaining calls to ~50 cumulative.

### Week 4 (Aug 18 – 25) — Money, then verdict
- **Day-30 card ask** to every household that reached 30 days — real payment link, real decision.
  This is H2's only behavioral evidence; everything else is stated intent.
- Exit interviews: 20 minutes, including "what would make you stop using this?"
- Registry updated with every evidence entry; dashboard regenerated.
- **G1 decision meeting (Aug 25).** Pre-committed thresholds, read as written:

| Gate | Threshold | Outcome |
|---|---|---|
| H1 | ≥50% still forwarding at week 3 | Proceed |
| H1 | <40% | **Kill the current shape** |
| H2 | ≥25% card conversion at day 30 | Proceed |
| H2 | <25% **and** H1 failing | **Kill** |
| H3 | One segment leads on (pain × commitment) | Wedge confirmed; PRD §4.1 clause self-deletes |
| Mixed | One wedge shows pull, shape doesn't | **One re-roll**: four more weeks, that wedge only |

## What I am rejecting from the next four weeks

Named explicitly, because unstated rejections come back as scope.

| Rejected | Reasoning |
|---|---|
| **The H8 rulebook spike (20h)** | Genuinely valuable and validates at G1 in the registry — but it is *strategic*, not existential, and it competes directly with H1/H2 for the scarcest resource. **Recommendation: contract it out, or move it to week 4 only if the funnel is ahead of schedule.** I am formally proposing it slip rather than dilute the founder's conversation volume. |
| All Tier 2 engineering (dispatcher, encryption module, ladder engine, problem mapping) | Defensible work, zero urgency, and every hour of review is an hour not spent on household twelve. |
| The `apps/web` scaffold and anything downstream of it | G1-dependent, and a scaffold is a magnet for premature feature work. |
| Learning dashboard implementation | Specified and deliberately unbuilt. Revisit in week 2 *only* if manual data has become genuinely illegible — the spec's Phase 1 exists for exactly that trigger. |
| Inbox OAuth, evaluation corpus, vendor seed data, extraction schemas | All G1-dependent by classification. |
| Any product feature work | There is no product to feature. The concierge service is the product this month. |

## How progress is measured this month

Not by commits. By the registry: **the number of evidence entries added, weighted by grade** — and
specifically whether H1 and H2 move off `untested`. A week that produced code but no evidence entry
on an existential assumption was a failed week, and the dashboard is built to say so out loud.
