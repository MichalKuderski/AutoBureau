# AutoBureau — Principal Engineer Architecture Review

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Scope:** Read-only. No changes made.
**Prior phases:** `00-ground-truth` · `01-current-state` · `02-ux-ui-audit` · `03-functional-interaction-audit`

---

## Executive judgment

**The architecture is sound and should not be rewritten.** It is, in its foundational layers,
better than the product stage requires — a deliberate bet that tenancy, contracts, and the
auth boundary are the expensive things to retrofit and the cheap things to get right early.
That bet was correct and it has paid off: the isolation model is verified rather than asserted,
and the fixture→API cutover is localized to twelve function bodies precisely because someone
paid the contracts tax up front.

What is missing is not architecture. It is **the middle of the system** — the domain API tier,
the outbox dispatcher, storage, and the identity lifecycle — plus the operational floor
(observability, deployment) without which none of it can be run in anger.

The one genuine architectural risk worth pausing on before more features land is the coupling
between the tenancy mechanism and connection lifetime: every authenticated request opens an
interactive transaction that pins a pooled connection, and this has never been measured under
concurrency because the application has never been deployed.

---

## 1. Current architecture (text diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                     │
│  React 19 · Next 15 App Router · Tailwind 4 · TanStack Query v5             │
│                                                                             │
│  Screens (14) ──────► lib/domain/queries.ts ──┬─► fixtures.ts   [11 of 12]  │
│   no component calls fetch directly           └─► apiFetch      [ 1 of 12]  │
│                                                                             │
│  providers: HouseholdProvider (server-injected) · QueryProvider · Theme     │
│  components: ui/ (17 primitives) · patterns/ (5) · layout/ (3)              │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ same-origin fetch, HttpOnly cookies
┌────────────────────────────────▼────────────────────────────────────────────┐
│ EDGE RUNTIME — middleware.ts                                                │
│  catch-all matcher · exact-match public allowlist · JWT verify (own JWKS)   │
│  expired+refreshable → /auth/refresh   ·   deny-by-default, fails closed    │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────┐
│ NODE RUNTIME (Next server)                                                  │
│                                                                             │
│  (app)/layout.tsx ─── server component                                      │
│    resolveRequestContext → withHousehold(4 sequential queries) → provider   │
│                                                                             │
│  /v1/* ─── authenticated() wrapper — THE ORDER IS THE CONTRACT              │
│    1 CSRF → 2 identity → 3 household(membership) → 4 can() → 5 runAsUser    │
│    → 6 handler → withHousehold(...)                                         │
│    endpoints: households/current                          ← 1 domain route  │
│                                                                             │
│  /auth/{callback,refresh}  ·  /v1/auth/{sign-in,sign-out,magic-link}        │
│                                     │                                       │
│                                     └──► GoTrue REST (provider.ts, 0 tests) │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ @autobureau/db — the only sanctioned door
┌────────────────────────────────▼────────────────────────────────────────────┐
│  Database class                                                             │
│   withPrincipal  (request.user_id, read-only)                               │
│   withHousehold  (request.household_id + user_id, audit flush pre-commit)   │
│   withIdentity   (mirroring only, writes with no household)                 │
│   unsafeAcrossAllHouseholds (dispatcher/BYPASSRLS; CI-fenced)               │
│   ── every one = ONE interactive transaction, GUC as first statement        │
│   ── audit extension observes/enforces; withHousehold persists              │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────┐
│ POSTGRESQL 16 + pgvector                                                    │
│  17 tables · 14 FORCE RLS keyed on request.household_id                     │
│  app_user: NOT superuser, NOT owner, NOBYPASSRLS  → policies actually apply │
│  users/user_profiles: no RLS by design (session-layer scoping)              │
│  vendors: global read  ·  audit_log: append-only, actor stamped by DB       │
│  outbox_events: WRITE-ONLY — no dispatcher, no claim query, nothing emits   │
└─────────────────────────────────────────────────────────────────────────────┘

ABSENT: services/ai · storage · outbox dispatcher · Redis client · reminder
        scheduler · email transport · payment processor · deployment config ·
        observability · E2E tier
```

**Shared packages:** `@autobureau/contracts` (edge-safe barrel + `/node` subpath for
`node:crypto`) · `@autobureau/db` (Node-only — uses `AsyncLocalStorage`).

---

## 2. Architecture strengths

These are real and several are unusual at this stage.

**S1 · Tenancy is enforced twice and verified once.** RLS in the database plus the scoped
client in code, with the GUC bound as a *parameter* rather than interpolated — closing a SQL
injection sink at the exact place a request-derived value meets SQL. Empirically reproduced:
unscoped reads return zero rows, scoped reads return exactly one household. `app_user` is
provably non-superuser, non-owner, `NOBYPASSRLS`, so the policies are not inert.

**S2 · The `/v1` boundary ordering is a genuine security property, not a convention.** CSRF →
identity → household → authorization → attribution → handler. A rejected request never opens a
household scope. Handlers cannot re-derive identity because they are not given the means to
interpret headers. This is the correct shape.

**S3 · Audit attribution cannot be forged by application code.** Rows are written with
`actor_id` omitted; the database stamps it from `app.current_user_id()`, and a CHECK constraint
rejects `user` rows without one. A bug in context propagation can only fail closed. The
extension/transaction split is a well-reasoned workaround for a real Prisma 6 limitation, and
the reasoning is recorded.

**S4 · Contracts as a first-class package.** RFC 8785 canonical JSON with a deliberate
profile constraint (safe integers only — rejecting floats removes an entire cross-runtime bug
class), RFC 9457 problem+json, a typed event registry, cross-runtime test vectors. The
edge-safe barrel with a `/node` subpath for `node:crypto` shows the module boundary was
discovered in practice and fixed properly rather than papered over.

**S5 · The fixture→API seam is genuinely well placed.** Every screen consumes
`lib/domain/queries.ts` and nothing else; no component calls `fetch`. Fixtures are shaped as
API responses. The single largest remaining work item is therefore contained to one file's
twelve function bodies plus the endpoints behind them. This is the difference between a
two-week cutover and a two-month one.

**S6 · Schema quality.** Integer-cents money (`BigInt`), `Decimal(4,3)` AI confidence,
household-prefixed composite indexes matching the RLS access pattern,
`@@unique([householdId, sha256])` for per-tenant dedupe, and thoughtful delete semantics —
`SetNull` on member so removing a person does not delete their obligations, `Cascade` on
household. Provenance columns on every AI-derived row.

**S7 · Fails closed everywhere, verified.** Unconfigured deployment: middleware denies every
non-public route (401/503 confirmed live), rather than the far more common failure of an
unconfigured deployment being an unauthenticated one.

**S8 · CI encodes governance.** Provider-SDK fence, dispatcher allowlist, PRD scope fence,
secret scan, assumption-registry validation. Architectural decisions are enforced mechanically
rather than by review memory.

**S9 · Frontend component architecture is clean.** 17 primitives → 5 patterns → 14 screens,
with no downward dependencies. Server/client boundary is correct: the household context is
resolved in a server component and injected, so tenant scope is never client state.

---

## 3. Architecture weaknesses

### P0 · Weaknesses that block the next milestone

**W1 · There is no domain API tier.** One domain endpoint exists. The `authenticated()`
wrapper is well designed and has exactly one consumer, so its ergonomics under real load
(pagination, filtering, partial updates, list envelopes) are entirely unproven. Every
architectural decision about the API surface — pagination style, filter encoding, list
response shape, PATCH semantics — is still unmade, and 14 screens are waiting on it.

**W2 · No identity lifecycle.** Nothing creates a household or a membership outside test
fixtures. The application performs exactly two writes in its entire codebase (`users`,
`user_profiles`). This is an architectural hole, not a missing screen: it determines the
sign-up flow, the invitation model, and the multi-household representation, and three other
subsystems (onboarding, entitlements, sharing) depend on the answer.

**W3 · The outbox is write-only and nothing writes to it.** `packages/db/src/outbox.ts`
exports `OutboxWrite` and `outbox()` — **no claim query, no dispatcher, no publish path exists
at all**. `REDIS_URL` is documented and read by no code. ADR-005's guarantee ("a domain change
and its event are written in one transaction, or neither is") is currently a guarantee about
zero events. Every asynchronous product behaviour — reminders, document processing, email —
is blocked behind this.

**W4 · Zero operational visibility.** Every server-side error log is gated on
`NODE_ENV !== "production"`. No Sentry, no OTel, no structured logger, no analytics. A
production 500 returns a generic problem+json and leaves **no record anywhere**. Combined with
W5 this means the first production incident would be diagnosed by guessing.

**W5 · Never deployed; no deployment configuration exists.** No Dockerfile, no `vercel.json`,
no Terraform, no `fly.toml`. Cold-start behaviour, connection-pool behaviour, JWKS fetch
latency on a cold isolate, and the transaction-pinning concern below are all unmeasured.

### P1 · Weaknesses that will bite as load and features arrive

**W6 · Tenancy is structurally coupled to connection lifetime.** Every scoped unit of work is
an interactive transaction that pins a pooled connection for its duration — this is *required*
for the GUC to apply, and the design is correct. But it means concurrency is bounded by pool
size rather than by CPU, and on a serverless platform behind a transaction-mode pooler that
ceiling arrives sooner than teams expect. `scoped.ts` documents the risk and pre-agrees the
escape hatch (relocate `/v1` to a long-lived Node service — "a redeploy, not a rewrite,
because the API is portable by construction"). That foresight is excellent. **The gap is that
the trigger metric is unmeasured and the 5 s timeout is the only guard.**

**W7 · The `(app)` layout runs four sequential queries inside one transaction.** Household,
members, entitlement, and viewer profile are four round trips holding a pinned connection, on
**every authenticated page render**. This is the single hottest path in the product and is the
obvious first amplifier of W6.

**W8 · Seven foreign keys have no covering index** (verified against the live schema):
`obligations.item_id`, `obligations.member_id`, `items.member_id`, `items.vendor_id`,
`items.source_document_id`, `household_members.user_id`, `households.created_by`.
PostgreSQL does not index FKs automatically. Two consequences: "filter by person" — a
documented product feature — sequential-scans `items` and `obligations`; and because several
of these carry `ON DELETE CASCADE`/`SET NULL`, deleting a member or household takes a
scan-under-lock. That is precisely the lock-impact question `CLAUDE.md` requires migration PRs
to answer.

**W9 · Idempotency is decorative.** `apiFetch` generates an `Idempotency-Key` for every unsafe
non-DELETE request and **no server code reads it**. The client comment claims "a double-tapped
button on a flaky train connection cannot create two obligations" — nothing dedupes. When
domain POSTs land, this will silently provide no protection unless implemented. Compounded by
`ObligationCard` and `ConfirmDialog` callers not passing `loading` (functional audit).

**W10 · `outbox_events` and `audit_log` grow without bound.** `@@index([publishedAt])` is a
full btree that will grow with every published row; the dispatcher's query
(`published_at IS NULL`) wants a **partial index**. Neither table has retention, archival, or
partitioning. `audit_log` is append-only by design and will be the largest table in the system.

**W11 · `provider.ts` has no tests.** The GoTrue REST client is the only external integration
and the only outbound network dependency in the product, and it is the one module with zero
coverage. Its failure taxonomy (rate-limited, unavailable, invalid) drives user-visible
behaviour on every auth path.

**W12 · Refresh cannot distinguish provider outage from revoked token.** `/auth/refresh`
catches everything and clears both cookies, so a transient GoTrue 5xx signs out every active
user simultaneously, and they cannot sign back in while it persists.

**W13 · No E2E tier.** 459 tests, none crossing the browser↔server boundary. Chromium and
Playwright are available in this environment and unused. Every P0 in the functional audit —
sign-out not signing out, dead links, post-login routing — is exactly the class of defect a
thin E2E suite catches and unit tests structurally cannot.

### P2 · Weaknesses worth recording, not yet acting on

**W14 · No client-side URL state.** Zero `useSearchParams` in `app/`; filters and tabs are
component-local, so back navigation resets them and filtered views are unshareable.

**W15 · Two independent JWKS caches** (edge middleware and Node handlers), each refetching per
isolate, with jose defaults and no local fallback.

**W16 · `getDatabase()` has no `globalThis` guard**, so Next dev HMR can accumulate
`PrismaClient` instances across reloads.

**W17 · No formatter.** No Prettier, no `.editorconfig`; style rests on convention and review.

**W18 · CI does not fence bare `PrismaClient` construction** — the invariant most likely to be
violated by ordinary feature work. It fences the escape hatch and provider SDKs but not this.

---

## 4. Highest-risk technical debt (ranked)

| # | Debt | Risk if unaddressed | P |
|---|---|---|---|
| 1 | **No identity lifecycle** (W2) | The product cannot admit a user. Blocks onboarding, entitlements, sharing, and every UX P0 that depends on real data | **P0** |
| 2 | **No observability** (W4) | First production incident is undiagnosable. This is the debt that turns every other bug into an outage | **P0** |
| 3 | **No domain API tier** (W1) | 14 screens blocked; every API-shape decision unmade and about to be made 13 times in a hurry | **P0** |
| 4 | **Never deployed** (W5) | All production characteristics unknown, including W6 | **P0** |
| 5 | **Outbox has no dispatcher** (W3) | Every async behaviour blocked; ADR-005's guarantee is vacuous | **P0** |
| 6 | **Transaction/connection coupling unmeasured** (W6/W7) | Correct design, unknown ceiling. Discovered under load rather than in review | **P1** |
| 7 | **Idempotency decorative** (W9) | Duplicate obligations and payments on retry, on mobile networks, in a product about deadlines | **P1** |
| 8 | **Unindexed FKs** (W8) | Seq scans on a documented feature; lock-under-scan on deletes | **P1** |
| 9 | **`provider.ts` untested** (W11) | The one external dependency, unverified | **P1** |
| 10 | **No E2E** (W13) | The exact defect class the functional audit found keeps recurring | **P1** |

---

## 5. Good enough — do NOT rewrite

Each of these is either correct, verified, or a deliberate decision with recorded reasoning.
Rewriting any of them spends the audit's credibility on churn.

| Component | Why it stays |
|---|---|
| `packages/db/src/scoped.ts` | The tenancy invariant. Empirically verified fail-closed. The GUC-as-parameter choice closes a real injection sink. Subtle and easy to break silently |
| RLS migrations + policies | 14 tables under FORCE RLS, reproduced independently. `users`/`user_profiles` exclusion is documented and defensible |
| `server/http/route.ts` ordering | "THE ORDER IS THE CONTRACT" is literally true. Reordering breaks the A7 property |
| `server/auth/*` (jwt, context, policy, session, pkce) | ~120 tests. Asymmetric-only verification, algorithms pinned in code not env, enumeration-safe error collapsing. Do not refactor for style |
| `middleware.ts` + `public-routes.ts` | Deny-by-default with 82 tests. Exact-match allowlist with an open-redirect guard |
| `packages/contracts` | Canonical hashing with test vectors, problem+json, edge/node split. This is the interoperability contract |
| `packages/db/src/audit.ts` | The extension/transaction split is a correct workaround for a real Prisma limitation, with the reasoning recorded |
| Prisma schema shape | Integer cents, provenance columns, household-prefixed indexes, sane cascade semantics. Add indexes; do not reshape |
| Design system (`globals.css`, `ui/`) | Token discipline, `:focus-visible`, reduced-motion, dark mode designed rather than inverted |
| `lib/domain/queries.ts` **signatures** | The cutover seam. Bodies change; signatures must not, or all 14 screens churn |
| `lib/api-client.ts` structure | Single HTTP door, typed errors, CSRF in one place. Only the idempotency half needs a server counterpart |
| CI guardrails | Encode governance mechanically |
| Turborepo + pnpm workspace | Appropriate for the size. No monorepo tooling change is warranted |

---

## 6. Harden BEFORE adding more features

Ordered. Each is a precondition for building on top without compounding risk.

**H1 (P0) · Observability floor.** Structured logging that works in production (remove the
`NODE_ENV` gate), error reporting, and request tracing with the `traceparent` the outbox schema
already anticipates. *Rationale:* every subsequent item is harder to build and impossible to
operate without this. It is also the cheapest P0.

**H2 (P0) · Deployment + environment management.** A deployment target, environment
promotion, and a rollback story. *Rationale:* W6 cannot be measured until the system runs
somewhere real, and every migration PR is required to state a rollback story it currently
cannot.

**H3 (P0) · Identity lifecycle.** Household creation, membership, and the multi-household
representation. *Rationale:* it is the root dependency of onboarding, entitlements, sharing,
and most UX P0s. Building screens before this means rebuilding them after.

**H4 (P0) · The domain API tier's *shape*, established once.** Before thirteen endpoints
exist, settle: list envelope, pagination, filter encoding, PATCH semantics, error mapping,
and **server-side idempotency** (W9). *Rationale:* these decisions are cheap once and
expensive thirteen times. The `authenticated()` wrapper is ready; its conventions are not.

**H5 (P1) · Connection-lifetime budget.** Measure transaction duration and pool wait under
concurrency; collapse the `(app)` layout's four queries into one (W7); set the alert that
triggers the pre-agreed escape hatch. *Rationale:* the design already names the risk and the
remedy. It needs a number.

**H6 (P1) · A thin E2E tier.** Five or six flows: sign-in, sign-out actually signs out,
protected-route redirect, session expiry, a create-and-persist round trip. *Rationale:* this
is the layer that would have caught most of the functional audit's P0s, and Playwright is
already available.

**H7 (P1) · Index and retention pass.** The seven FK indexes, a partial index on
`outbox_events (id) WHERE published_at IS NULL`, and a retention decision for `audit_log`.
*Rationale:* cheap now, a migration-under-lock later.

**H8 (P1) · Test `provider.ts`.** The only external integration.

**H9 (P1) · CI fence for bare `PrismaClient`.** One grep, closes the invariant most exposed to
ordinary feature work.

---

## 7. Can safely wait

| Item | Why it waits |
|---|---|
| `services/ai` (FastAPI/LangGraph) | Nothing to process until storage and ingestion exist. ADR-006's gateway fence already prevents accidental coupling |
| pgvector HNSW index | Documented as unnecessary below ~50k chunks/household; exact KNN within one tenant is correct today |
| `packages/ui` extraction | One consumer. Extraction before a second app is speculative |
| Redis / Streams tuning | Nothing publishes yet |
| Multi-region, read replicas, sharding | No traffic |
| URL state for filters (W14) | Real usability debt, but cosmetic beside persistence |
| Prettier (W17) | Lint gate holds the line; a formatter is a one-day change whenever |
| `globalThis` Prisma guard (W16) | Developer-experience only |
| JWKS cache tuning (W15) | Defaults are reasonable; revisit with real latency data from H1/H2 |
| Payment processor | Blocked on H3 and metering |

---

## 8. Recommended target architecture — next milestone

**Deliberately incremental.** Every arrow below is either already built or a filled gap. No
layer is replaced.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BROWSER — unchanged component architecture                                  │
│  Screens ──► lib/domain/queries.ts ──► apiFetch ──► /v1     ← ONLY CHANGE:  │
│                                                       12 hook bodies swap   │
│  + URL-synced filters (later)   + household header from active-household    │
└────────────────────────────────┬────────────────────────────────────────────┘
┌────────────────────────────────▼────────────────────────────────────────────┐
│ middleware.ts — UNCHANGED                                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
┌────────────────────────────────▼────────────────────────────────────────────┐
│ /v1 domain API — the milestone's real work                                  │
│  authenticated() wrapper UNCHANGED; new endpoints adopt shared conventions: │
│    · list envelope + cursor pagination        · problem+json (exists)       │
│    · Idempotency-Key honoured server-side  ← NEW, closes W9                 │
│    · capability required per route via can() (exists)                       │
│                                                                             │
│  households (create!) · members · items · obligations · documents           │
│  · notifications · settings · entitlements                                  │
│                                                                             │
│  identity lifecycle: sign-up → mirror → CREATE household + membership  ← NEW│
│  active-household selection (cookie or segment)                       ← NEW │
└────────────────────────────────┬────────────────────────────────────────────┘
┌────────────────────────────────▼────────────────────────────────────────────┐
│ @autobureau/db — UNCHANGED public surface                                   │
│  + outbox(tx).emit() actually called by write handlers                      │
│  + claim query: SELECT … WHERE published_at IS NULL FOR UPDATE SKIP LOCKED  │
└────────────────────────────────┬────────────────────────────────────────────┘
┌────────────────────────────────▼────────────────────────────────────────────┐
│ POSTGRES — UNCHANGED schema shape                                           │
│  + 7 FK indexes    + partial index on outbox_events    + retention policy   │
└─────────────────────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────────────────┐
│ NEW: dispatcher worker (long-lived Node, app_dispatcher role)               │
│  outbox → Redis Streams → consumers (reminders, notifications)              │
│  Also the pre-agreed home for /v1 if H5's pool metric says so               │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│ NEW: operational floor — structured logs · error reporting · traces ·       │
│      deployment config · environment promotion · rollback                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sequence:** operational floor (H1, H2) → identity lifecycle (H3) → API conventions (H4) →
endpoint build-out + hook cutover → outbox dispatcher → storage + ingestion.

Storage and the AI service come *after* this milestone. The dispatcher is worth building
early not because reminders are urgent, but because it is also the escape-hatch host for `/v1`
if H5's measurements demand it — one piece of infrastructure retiring two risks.

---

## 9. Explicit DO NOT REWRITE list

Do not restructure, "modernize," or refactor for style:

1. **`packages/db/src/scoped.ts`** — the tenancy invariant.
2. **RLS migrations and policies** — change only by additive migration with a stated lock impact.
3. **`server/http/route.ts` boundary ordering** — the order is a security property.
4. **`server/auth/{jwt,context,policy,session,pkce}.ts`** — ~120 tests; provider-agnostic by design.
5. **`middleware.ts` and `public-routes.ts`** — deny-by-default; the allowlist is a security surface.
6. **`packages/db/src/audit.ts`** — the split is a correct workaround, not an accident.
7. **`packages/contracts`** — canonical hashing, problem+json, edge/node split.
8. **Prisma schema shape** — add indexes; do not reshape models or cascade semantics.
9. **`lib/domain/queries.ts` signatures** — bodies change, signatures do not.
10. **`lib/api-client.ts`** — single HTTP door; add the server half of idempotency, keep the client.
11. **Design system tokens and `ui/` primitives** — token discipline is the reason the UI is consistent.
12. **CI guardrails** — add the `PrismaClient` fence; remove nothing.
13. **Turborepo/pnpm workspace layout** — appropriate for the size.

**The one thing worth changing that looks like a rewrite but is not:** collapsing the `(app)`
layout's four sequential queries into a single query (W7). Same transaction, same scoping, same
public behaviour — one round trip instead of four on the hottest path in the product.

---

## Closing note on sequencing

The strong temptation after four audits is to start fixing the long P0 lists. Resist it for one
beat: **H1 (observability) and H2 (deployment) should land before anything else**, because they
are the only items that change what you can *know* about every subsequent change. Everything
else on the P0 list is work you can verify locally; those two are the difference between
shipping and hoping.
