# Architecture Decision Traceability Matrix

**Purpose:** answer "why does this exist?" for any artifact in the repository without reading the
repository. Every implemented component traces to the decision that required it, the specification
that scopes it, the tests that prove it, and the guardrail that keeps it true.

**Maintenance rule:** a pull request that adds a module adds a row. A row with no test and no
guardrail is a code smell — it means an invariant is being held by memory.

**Legend:** `ARCH` = `docs/architecture/NN-*.md` · `ADR` = `docs/architecture/adr/` ·
`REVIEW` = `docs/architecture/review/2026-07-23-principal-panel-review.md` (amendments A1–A9,
findings F-01…F-20) · `PRD` = `docs/product/PRD-v1.md` · `STRAT` = `docs/strategy/`

---

## 1. Implemented

| Component | Why it exists (one line) | ARCH | ADR | PRD | STRAT | Tests | CI guardrail |
|---|---|---|---|---|---|---|---|
| `packages/contracts/src/canonical.ts` | Payload hashing must be byte-identical across runtimes, or approvals fail closed on legitimate actions | 04 §6 | 008 | §14 | — | `tests/canonical.test.ts` (20) + `test-vectors/canonical.json` | — |
| `packages/contracts/test-vectors/canonical.json` | The cross-runtime contract: a second implementation must reproduce these bytes | 04 §6 | — | — | — | consumed by canonical tests | vectors change ⇒ contract review |
| `packages/contracts/src/domain/common.ts` | Frozen enums; the eight launch document types are a scope boundary, not a preference | 02 | 008 | §8 F7 | red-team §18 | `tests/contracts.test.ts` | PRD scope fence |
| `packages/contracts/src/domain/entities.ts` | One shape per ledger noun, validated at every boundary | 02 | 008 | §12 | ledger §8 | `tests/contracts.test.ts` | — |
| `packages/contracts/src/events.ts` | Event taxonomy is a registry, not a convention; payloads carry IDs, never state | 07 §1, §4 | 005 | — | — | `tests/contracts.test.ts` | — |
| `packages/contracts/src/problem.ts` | RFC 9457 error shapes are part of the contract, not per-handler improvisation | 03 §1 | 008 | §12 | — | `tests/contracts.test.ts` | — |
| `packages/contracts/src/ids.ts` | Time-ordered identifiers for insert locality on the large tables | 02 §10 | — | — | — | `tests/ids.test.ts` (4) | — |
| `packages/db/prisma/schema.prisma` | The ledger's physical form, scoped to version one | 02 | 002 | §8, §12 | ledger §8 (A-F1/F2/F3), red-team (A-B8) | integration suite | PRD scope fence |
| `…/migrations/20260728000000_init` | Reproducible schema creation, generated offline from the model | 02 | 002 | — | — | applied by integration bootstrap | — |
| `…/migrations/20260728000001_rls` | The second wall: catches the scoping bug we will eventually write | 06 §5 | 002 | §13 | — | `tenancy.integration.test.ts` (12) | — |
| `packages/db/src/scoped.ts` | **Blocker fix.** Transaction-local scope; session-level would leak across pooled connections | 06 §4–5 | 002 | §13 | REVIEW A1/F-01 | `tests/unit/scope.test.ts` (8) + integration | escape-hatch allow-list |
| `packages/db/src/outbox.ts` | Domain write and its event commit together, or neither does | 07 §1–2 | 005 | §12 | — | outbox atomicity tests | — |
| `packages/db/src/index.ts` | Withholding the bare client is the enforcement mechanism for invariant 1 | 06 §4 | 002 | — | FP §7 | — | escape-hatch allow-list |
| `.github/workflows/ci.yml` | Invariants held by machines, not vigilance | 09 §4 | — | §20 | FP §5 | negative-control tested | *is* the guardrail |
| `CLAUDE.md` | Working agreements survive sessions that lack the original context | — | — | §21 | — | — | — |
| `FOUNDING_PRINCIPLES.md` | Constitutional layer; outranks instinct | — | — | — | all | — | — |
| `ops/assumptions.yaml` | The company runs on hypotheses; they are versioned like code | — | — | §10–11 | blueprint §0 | `ops/tests/assumptions.test.ts` | schema validation |
| `docker-compose.yml` | Local parity: the full stack runs on one machine | 09 §1 | — | — | — | — | — |
| `.env.example` | Teaches the non-privileged application connection; a superuser URL here would make RLS silently inert | 06 §5 | 002 | §13 | REVIEW F-01 | — | — |
| `ops/founder-os.md` | The daily driver: schedule, cadences, and review rituals that keep the month pointed at H1/H2 | — | — | §10–11 | blueprint P0 | — | — |
| `ops/concierge-operations.md` | SOPs for delivering the product manually; the service is the validation instrument | 08 | — | §10–11 | blueprint P0 | — | — |
| `ops/participant-crm.md` + `templates/participants.csv` | One row per person, sourced → converted; the only file holding names | 13 §4 | — | §10 | blueprint P0 | — | — |
| `ops/evidence-system.md` + `templates/evidence-log.csv` | Standardized observation records; the feed into the registry | — | — | §10–11 | FP §10 | — | — |
| `ops/friday-metrics.md` | The weekly worksheet; definitions deliberately not restated | 10 §6 | — | §10–11 | learning-dashboard-spec §5 | — | — |
| `ops/g1-readiness.md` | Pre-committed gate thresholds + data-sufficiency check, written before the data existed | — | — | §10–11 | blueprint G1 | — | — |
| `ops/decision-journal.md` | Auditable record of consequential decisions and the evidence behind them | — | — | §21 | FP §10 | — | — |
| `ops/p0/*` | Interview script and landing-page test — the two instruments the founder runs personally | — | — | §10–11 | blueprint P0 | — | — |
| `ops/dashboard.html` | Pre-planning view of the registry; hand-maintained snapshot until the generator ships | — | — | §10 | — | — | governance job |
| `docs/product/learning-dashboard-spec.md` | Design for turning every interaction into visible knowledge change; deliberately unimplemented | 10 §6 | — | §10–11 | blueprint P0 | — | — |
| `docs/product/pre-g1-backlog.md` | The scope fence in schedule form: what engineering may build before the gate | — | — | §9 | blueprint P0 | — | — |

## 2. Guardrails → the invariant each protects

| Guardrail (CI job step) | Invariant | Source | Negative-control tested |
|---|---|---|---|
| No provider-SDK imports outside the AI service | FP §7.6 — all model access via gateway | ADR-006 | ✅ |
| Escape hatch stays allow-listed | FP §7.1 — no ambient RLS bypass | ARCH 06 §5 | ✅ |
| Product scope fence (postponed models absent) | FP §8 — postponements are decisions | PRD §9 | ✅ |
| Tenant-isolation suite must pass | FP §7.1–2 — isolation is verified, not asserted | REVIEW F-01 | ✅ (fail-closed test) |
| Secret scan | FP §6 — key custody | ARCH 12 §8 | vendor-provided |
| Assumption registry schema validation | Registry stays machine-readable and complete | this document §1 | ✅ |

## 3. Absent by decision

The most common "why does this exist?" question is actually "why doesn't this exist?" — these are
the answers, so nobody helpfully adds them back.

| Not built | Reason | Where decided | Returns when |
|---|---|---|---|
| `conversations` / `messages` tables, chat UI | Weakest differentiation, largest model cost, real injection surface | PRD §9; red-team §18 | Version two, if search telemetry proves demand |
| `task_runs` / `approvals` tables, agent execution | Version one ships templates the user sends; approval architecture stays on paper | PRD §9; red-team §18 | Act II (Resolve) |
| Vector index (HNSW) on chunks | Queries never span tenants; exact scan within one household beats filtered ANN and has no recall pathology | REVIEW A3/F-05; ADR-003 | Past ~50k chunks per household |
| Multi-user logins, invites, roles UI | Caregiver wedge needs multi-*member*, not multi-*user*; schema already carries households | PRD §9 | Post-launch |
| Bank/transaction ingestion | Imports a regulatory regime and a dependency on a contested rule | PRD §6; deep-dive §Part VI | Act II, monetization decision first |
| Credential storage, money movement, tax filing | Company-ending risk classes before the brand exists | FP §11; PRD §6 | Never (first two); with a decision record (third) |
| Application scaffold (`apps/web`) | Every first screen is wedge-dependent; scaffolding invites premature feature work | backlog §Depends on G1 | After the validation gate |
| Decision records for inbox ingestion, rulebook subsystem, monetization stance | Each depends on the validation outcome; writing them now would record a guess | blueprint P1 | At the gate |

## 4. How to read a component's provenance

Given any file, the chain is: **file → row in §1 → the four documents → the reason.** If a file
cannot be traced, one of two things is true, and both are defects:

1. It is unnecessary — delete it.
2. A decision was made and never written down — write it down, then add the row.
