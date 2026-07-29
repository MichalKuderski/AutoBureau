# Pre-G1 Engineering Backlog

**Date:** 2026-07-28 · **Context:** foundation complete (contracts, tenancy, outbox, CI, governance).
The critical path to the company's survival is the validation sprint, not this backlog.

**Classification test — deliberately strict.** An item is *zero-regret* only if **all four** hold:
1. It cannot change based on which wedge G1 selects.
2. It cannot change if G1 says *kill* (i.e. it would still have been correct to build, or its cost
   is trivial enough that the answer doesn't matter).
3. It encodes a constitutional invariant or fixes a known correctness trap — not a convenience.
4. It does not create surface area that invites premature feature work.

Anything failing one test drops a tier. When uncertain, drop a tier: the cost of deferring correct
work is a week; the cost of building the wrong thing is a week *plus* the gravitational pull it
exerts on everything after it.

---

## Tier 1 — Zero-regret

| # | Item | Reasoning | Size |
|---|---|---|---|
| Z1 | **Pin local and CI Postgres to the same major version** | Local compose targets pg16; the verified run used pg18. Version skew between local and CI produces failures nobody can reproduce. Zero product content, and correct under every G1 outcome. | XS |
| Z2 | **PII redaction utility for logs** (`packages/observability` or contracts) | Constitutional invariant 5 and architecture doc 10 §3: identifier-grade values never reach logs. The rules — emails, names, document text, secret-shaped strings — derive from principle, not persona. Every future service imports it, so building it after the first service exists means retrofitting. | S |
| Z3 | **DST-safe scheduling primitives** (pure functions: local-time + zone → UTC instant; ladder offset arithmetic) | Review finding F-20. Reminder correctness across spring-forward and fall-back is a known trap that will otherwise be discovered by a user missing a deadline. Pure functions, exhaustively testable offline, wedge-independent — the *ladder values* are wedge-dependent, the *arithmetic* is not. | S |
| Z4 | **Test fixture factory** (typed builders for household / member / item / obligation graphs) | Every future test needs it; today each test hand-rolls seed data, which is how test suites become unmaintainable. Shapes are frozen by the data model. | S |
| Z5 | **CI completeness pass**: include the ops registry tests, pin Node/pnpm versions, cache Prisma engines | The guardrails only protect what the pipeline actually runs. Trivial and unconditionally correct. | XS |

**Total: roughly two focused days.** All five are mechanism, not product.

## Tier 2 — Probably zero-regret (build only if genuinely blocked on something else)

| # | Item | Why it *probably* holds | Why it isn't Tier 1 |
|---|---|---|---|
| P1 | Envelope-encryption module for identifier-grade values (ADR-007) | The interface — encrypt/decrypt with versioned data keys, `last4` retained — is settled by decision record and cannot change with the wedge. | The key-provider binding needs cloud-account decisions that don't exist yet; building against a local provider risks an interface shaped by the stub. Also unused until documents flow. |
| P2 | Reminder ladder **engine** (materialize rows from a ladder spec; snooze reshuffles; idempotent on re-run) | The mechanism is frozen by architecture doc 07 §5 and the data model. | The ladder *values* per obligation kind are wedge-dependent, and an engine written without a real ladder tends to encode the example it was written against. |
| P3 | Outbox dispatcher (claim with `SKIP LOCKED`, publish, mark published) | The claiming half is settled by ADR-005; the transport is explicitly swappable by design. | There are no consumers. A dispatcher publishing to nothing is untestable in the way that matters, and its retry/DLQ semantics deserve a real consumer to be designed against. |
| P4 | Problem+JSON mapping helpers (domain error → RFC 9457 body) | The contract is frozen (doc 03 §1). | The useful half is framework middleware, which belongs to an application scaffold that is itself G1-dependent. |

## Tier 3 — Depends on G1

| # | Item | What G1 changes about it |
|---|---|---|
| G-1 | Application scaffold (`apps/web`) | Every first screen is wedge-shaped. More importantly: a scaffold is a magnet for premature feature work, and the strongest scope defense available right now is that there is nowhere convenient to put a feature. |
| G-2 | Extraction schemas for the eight document types | PRD §4.1 permits a one-type swap on G1 evidence; `medical_bill` exists specifically because of the caregiver hypothesis. |
| G-3 | Census/onboarding content and flow | The census *is* the wedge — a caregiver takeover checklist and a visa-holder timeline are different products. |
| G-4 | Copy register, email templates, digest voice | Relief vs. greed vs. fear is exactly what the landing-page test decides. |
| G-5 | Reminder ladder values per obligation kind | Runway needs differ by persona and obligation class; the concierge cohort produces the real answer. |
| G-6 | Vendor rulebook seed data | Which states, insurers, and vendors to encode follows from the wedge. The *spike* (H8) runs during P0 to price the work; the *content* waits. |
| G-7 | Evaluation corpus and thresholds | Fixtures come from concierge documents, pre-labeled by real corrections. Building the harness before the corpus means tuning against synthetic data. |
| G-8 | Learning dashboard implementation | Specified (`learning-dashboard-spec.md`); its Phase-1 inputs are shaped by what P0 actually collects. Build it when there is data to render — around week 2 of the sprint, if the founder wants it. |

## Tier 4 — Explicitly deferred (decisions, not backlog)

| # | Item | Reason | Returns when |
|---|---|---|---|
| D1 | Chat assistant, agent execution, approval machinery, multi-user logins, transaction ingestion, native apps, public API | PRD §9 postponements. Each is a decision with a recorded reason. | Version two or later, via PRD §21 |
| D2 | Decision records for inbox ingestion, rulebook subsystem, monetization stance | Writing them now records a guess as though it were a decision — the failure mode decision records exist to prevent. | At the gate they depend on |
| D3 | AI service skeleton (`services/ai`) | No caller, no corpus, no thresholds. A skeleton would ossify choices that evaluation data should make. | Post-G1, with G-7 |
| D4 | Infrastructure as code, deployment pipelines, observability wiring | Nothing to deploy and nothing to observe. Premature infrastructure is the most expensive kind of unused code. | When the walking skeleton needs an environment |
| D5 | Inbox OAuth implementation | G3-era feature. **But its dependency is not engineering:** the verification and annual security assessment have multi-month lead times, so *starting the paperwork* is a scheduling task for the founder now, not code. | G2→G3 transition |
| D6 | Vector index on chunks | Amendment A3 — exact per-tenant scan is correct until roughly 50k chunks per household. | At the documented tripwire |

---

## Recommendation

**Do Tier 1 (about two days), then stop.**

Everything in Tier 2 is defensible and none of it is urgent; the honest reason to leave it is that
engineering capacity is not the constraint this month — founder attention is. Every hour spent
reviewing a dispatcher implementation is an hour not spent recruiting household number twelve, and
H1 and H2 remain untested at low confidence with an existential cost of being wrong.

The strongest engineering contribution to the next four weeks is the work already done: a foundation
that is verified, guarded, and traceable, so that when G1 says *proceed*, the walking skeleton starts
on solid ground rather than on a scaffold built around the wrong guess.

If the sprint stalls or engineering capacity genuinely idles, take Tier 2 in the order listed — P1
first, since encryption is the item most painful to retrofit once real documents exist.
