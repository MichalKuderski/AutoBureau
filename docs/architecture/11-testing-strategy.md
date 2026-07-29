# 11 — Testing Strategy

Two test economies: deterministic software (classic pyramid, cheap, run always) and probabilistic AI (evals, costs real money, run on change + schedule). Confusing the two produces either flaky CI or untested AI. They are kept separate on purpose.

## 1. Deterministic pyramid

| Layer | Tooling | Scope & rules |
|---|---|---|
| Unit | Vitest (TS), pytest (Py) | Policy module (`can()`), obligation recurrence math, reminder-ladder derivation, redaction, canonical-JSON hashing, chunking. Fast, no I/O. |
| Integration | Testcontainers (Postgres+pgvector, Redis) | Repository/module tests against real Postgres — **RLS policies are tested here** (attempt cross-household reads as `app_user`; must fail). Outbox→dispatcher→consumer round-trips. |
| Contract | Schemathesis + OpenAPI examples replay | Every endpoint: schema conformance, authz matrix (each role × each route), problem+json shapes, idempotency-key replay. |
| E2E | Playwright against preview/staging | The five journeys: onboard→upload→review→obligation; forward email→document appears; snooze/complete; task run→approve→artifact; export. Axe accessibility checks in the same runs. |
| Load | k6 | Smoke on every staging deploy (10 VU); monthly capacity run against design point (doc 05 §7) with regression budget. |

Coverage gate: 80% lines on `modules/*` and `services/ai/src/core|gateway` — enforced on changed files, not repo-wide vanity metrics.

## 2. AI evaluation harness (the part most teams skip)

### 2.1 Golden corpus
- Target at launch: **300+ labeled documents** across the 8 launch doc types (PRD F7; "~25" was the pre-PRD estimate) (synthetic + purchased samples + team's own anonymized paperwork; never user data without explicit consent flag).
- Each fixture: file + expected `doc_type` + expected extraction JSON + expected obligations. Stored in a private eval bucket, versioned by manifest; corpus grows continuously from review-queue corrections (which arrive pre-labeled by the user — the product manufactures its own eval data).

### 2.2 Metrics & gates

| Route | Metric | Gate (block deploy below) |
|---|---|---|
| `classify.doc_type` | accuracy | ≥ 97% |
| `extract.structured` | field-level F1 (per doc_type); date fields exact-match | ≥ 0.92 overall; expiry/due dates ≥ 0.98 |
| obligation proposal | precision / recall vs labels | precision ≥ 0.9 (wrong obligations erode trust faster than missed ones) |
| `chat.assistant` | grounding: % answers with valid citations; refusal-correctness on unanswerables | ≥ 95% cited; LLM-judge (different provider) + spot human review |
| injection canaries | attack success rate | **0** tolerated: any canary breach blocks deploy |

### 2.3 When evals run
- On any PR touching prompts, routes, schemas, or workflow graphs (subset: ~50 fixtures, ~$5).
- Nightly full run against production config (drift detection — providers change models under stable IDs less than they used to, but trust nothing).
- Before any model/route flip (doc 04 §9) — candidate vs incumbent A/B on the full corpus.

### 2.4 Threshold governor
Auto-apply thresholds (doc 04 §5.1) are *outputs* of the eval system: per doc_type×field, choose the confidence cutoff that yields ≥ 99% precision on auto-applied values in the corpus; everything below routes to review. Live accept-rate (doc 10 §6) < 75% for any doc_type automatically reverts that type to review-everything and opens an incident.

## 3. Adversarial suite

- **Injection canaries** (grow forever, never shrink): instructions embedded in PDFs/images/email bodies attempting: data exfiltration into drafts, obligation tampering, tool-call escalation, cross-household reads. Assert: flagged suspicious, no unauthorized writes, approval payloads clean.
- **Tenancy fuzzing**: property-based tests generating cross-household access attempts through every API route and through chat retrieval.
- **Malformed input zoo**: encrypted/malformed/zip-bomb PDFs, 0-byte files, wrong-extension files, 600-page scans — pipeline must reject gracefully per doc 05 §6.

## 4. Test data policy

Synthetic data generator (faker-based, per-locale) builds realistic households; anonymized-real fixtures require a signed-off scrub checklist. Production data never leaves production (doc 09 §1) — including into evals.

## 5. Definition of done (feature-level)

A feature PR ships with: unit tests for logic, integration test if it touches DB/events, contract update + examples if it touches API, eval fixtures if it touches AI behavior, audit-log coverage for new mutations, and a docs touch (this set or runbooks). CI enforces the mechanical parts; review enforces the rest.
