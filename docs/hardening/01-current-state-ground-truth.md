# AutoBureau — Current State / Ground Truth Report

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh` (base `origin/main` @ `56cf76e`)
**Scope:** Read-only inspection. No application behaviour was modified.
**Companion:** `docs/hardening/00-ground-truth.md` (verification log — build/test/RLS evidence)

---

## 0. Repository hygiene (checked first)

| Check | Finding |
|---|---|
| Current branch | `claude/autobureau-hardening-audit-1tb0gh`, tracking `origin/main` |
| Uncommitted changes | **None.** `git status --porcelain -uall` is empty |
| Stashes | None |
| Tracked build artifacts | **None.** No `dist/`, `.next/`, `.env`, logs, or screenshots tracked |
| `.gitignore` | Correct and specific (includes local `.claude/` and preview screenshots) |
| Unfinished local work | None found. Nothing was discarded or overwritten |
| History | 25 commits, 3 authors, linear and well-described |

Hygiene is genuinely good. The only branch anomaly (a squash-merge divergence) was resolved
in Phase 0 and confirmed content-identical before rebasing.

---

## A. System map

### A.1 In plain English

AutoBureau today is **two products glued at one seam.**

The first is a *security foundation*: a Next.js application with a properly built
authentication boundary — deny-by-default routing, asymmetric JWT verification, HttpOnly
cookie sessions, CSRF enforcement, and a PostgreSQL database where tenant isolation is
enforced by row-level security rather than by application discipline. This half is real,
carefully reasoned, and tested to a standard well above normal for a pre-seed product.

The second is a *product demonstration*: fourteen polished screens — dashboard, obligations,
documents, calendar, timeline, household, settings — that render a fictional caregiver
household from an in-memory fixture file. They look and behave like a finished application.
None of their data comes from the database, and none of their actions persist anything.

**The seam between the two halves is almost entirely unbuilt.** Exactly one of twelve data
hooks reaches the server. There are six HTTP endpoints, four of which are authentication.
And critically, **no code path anywhere creates a household** — so the foundation cannot
currently admit a real user to the product it protects.

### A.2 Technically

```
Browser
  │
  ├─ middleware.ts ─────── deny-by-default; verifies JWT from HttpOnly cookie
  │                        exact-match public allowlist; expired+refreshable → /auth/refresh
  │
  ├─ (app) route group ─── server component resolves RequestContext,
  │                        opens ONE db.withHousehold() transaction  ← only real domain read
  │                        └─ client screens ─→ useQuery ─→ fixtures.ts  ← everything else
  │
  ├─ /v1/* ─────────────── authenticated() wrapper:
  │                        CSRF → identity → household → can() → runAsUser → handler
  │                        (1 domain endpoint: GET /v1/households/current)
  │
  └─ /auth/{callback,refresh} ── PKCE redemption + refresh rotation (public by necessity)

Server
  └─ packages/db · Database.withHousehold / withPrincipal / withIdentity
                   every scoped unit = 1 transaction, first statement sets the GUC
       └─ PostgreSQL 16 + pgvector
            17 tables · 14 with FORCE RLS · policies keyed on request.household_id
            app_user: non-superuser, non-owner, NOBYPASSRLS
```

**Stack:** pnpm 10 workspaces + Turborepo · Next.js 15.5 (App Router, React 19) ·
TypeScript 5.9 strict · Tailwind CSS 4 · TanStack Query v5 · Zod 3 · Prisma 6 · `jose` for
JWT · Vitest 3 (+ happy-dom, Testing Library).

**Packages:** `apps/web` (~16,200 LOC) · `packages/contracts` (473 LOC — Zod schemas, event
taxonomy, canonical hashing, problem+json) · `packages/db` (571 LOC — scoped client, audit,
outbox) · `ops` (assumption registry + schema tests).

---

## B. Implemented vs partial vs mocked

### B.1 Implemented and verified

Backed by passing tests that exercise the real mechanism.

| Capability | Evidence |
|---|---|
| **Tenant isolation (RLS)** | 48 db + 98 web integration tests on a genuinely RLS-bound connection. Independently reproduced: unscoped → 0 rows, scoped → exactly 1 household |
| **Scoped transaction client** | `withHousehold`/`withPrincipal`/`withIdentity`, GUC bound as a parameter (never interpolated), UUID-asserted, 5 s ceiling |
| **JWT verification** | 26 tests. Asymmetric-only by construction; algorithms pinned in code, not env |
| **Request-context resolution** | 23 tests. Identity only from verified `sub`; `X-Household-Id` is a *candidate* checked against membership; enumeration-safe error collapsing |
| **Route protection** | 50 middleware tests. Catch-all matcher; unconfigured deployment denies rather than fails open |
| **CSRF** | 19 tests. Unconditional on every unsafe method including DELETE |
| **Public-route allowlist** | 32 tests. Exact-match, no prefixes; open-redirect guard rejects `//`, `/\`, control chars |
| **PKCE magic link** | 14 unit + 26 integration tests |
| **Session cookies** | 12 unit + 20 integration tests |
| **Identity mirroring** | 14 integration tests; DB-stamped audit actor |
| **Authorization matrix** | 24 tests over 10 capabilities × 3 roles |
| **Security headers** | Verified live on a running server: CSP, HSTS, X-CTO, XFO, Referrer-Policy, Permissions-Policy |
| **Fail-closed when unconfigured** | Verified live: `/v1/households/current` → 401, `/v1/auth/sign-in` → 503 |

### B.2 Implemented but insufficiently verified

| Capability | Gap |
|---|---|
| **`/v1` boundary composition** (`route.ts`) | Covered indirectly by the 38-test boundary integration suite, but has no unit test of its own |
| **GoTrue provider client** (`provider.ts`) | **No tests at all.** This is the sole external integration and the only outbound network dependency |
| **API client** (`api-client.ts`) | No tests. Owns CSRF header attachment, idempotency keys, and error normalisation |
| **Outbox writer** | Tested in `packages/db`, but **zero production callers** — never exercised in a real flow |
| **Session refresh** | Logic is tested; the *provider-outage* branch ends the session (see D.4) |
| **Audit log** | Enforced and tested at the DB layer, but almost nothing writes domain rows to audit |

### B.3 Partially implemented

| Capability | State |
|---|---|
| **Entitlements** | Table + quota columns exist and are RLS-protected. Read in exactly one place (`(app)/layout.tsx:101`) to derive `plan`. **No quota is enforced**; `docs_used_this_period` is never read or written |
| **Multi-household support** | Server handles it correctly (`X-Household-Id` → membership check). Client **never sends the header**; `HouseholdSwitcher` is a static display card that cannot switch. Consequence in D.3 |
| **Document upload UI** | Dropzone renders and accepts files, then **discards them and shows a success toast**. No storage backend exists |
| **Email ingestion** | `inbound_emails` table + RLS policy exist. The alias shown to users is **fabricated client-side** (`h-${id.slice(0,6)}@in.autobureau.com`) rather than the real `emailAlias` column already loaded into the provider |

### B.4 Mocked / placeholder

| Surface | Reality |
|---|---|
| **All domain reads** | 11 of 12 hooks resolve from `lib/domain/fixtures.ts` behind a 220 ms fake latency |
| **All domain mutations** | `setTimeout` returning the input argument. Nothing persists; state is lost on reload |
| **Sign-up** | `window.setTimeout(…, 500)` then `router.push("/onboarding")`. **Creates no account** |
| **Onboarding** | Pure React `useState`. Explicitly no persistence. Creates no household, no members |
| **Billing** | Local `useState`; `docsUsed = 7` hardcoded; "Upgrade" flips a boolean and toasts |
| **Forgot password** | Form only |

### B.5 Missing entirely

| Absent | Note |
|---|---|
| **Household creation** | *No code anywhere creates a `households` or `household_users` row* — only test fixtures do. See D.1 |
| **AI / document pipeline** | No model calls, no embeddings, no gateway, no `services/ai`. `document_chunks.embedding vector(1024)` is never written |
| **File storage** | No S3, no Supabase Storage, no presigned URLs, no multipart handling |
| **Outbox dispatcher** | No worker process. `REDIS_URL` is in `.env.example` but **read by no code**; compose starts Redis, nothing connects |
| **Reminders / notifications delivery** | `reminders` table exists; no scheduler, no email/push sender |
| **Payment processor** | Stripe appears nowhere |
| **Plaid** | Absent, and constitutionally postponed |
| **Deployment config** | **No Dockerfile, no `vercel.json`, no Terraform, no `fly.toml`.** The app has never been deployed |
| **Observability** | No Sentry, OTel, logger, or analytics of any kind |
| **Rate limiting** | Provider 429s are *handled*; AutoBureau enforces none of its own |
| **Formatter** | No Prettier, no `.editorconfig` |

---

## C. Critical dependencies

Where systems are coupled such that changing one breaks others.

1. **`RequestContext` resolution is the universal chokepoint.** Middleware, the `(app)`
   server layout, and every `/v1` handler all call `resolveRequestContext`. Its
   membership-count branching (0 → 403, 1 → ok, >1 → 400) silently governs whether the
   product is reachable at all. **Any household work touches this first.**

2. **`lib/domain/queries.ts` is the single cutover point.** All 14 screens depend on it and
   nothing else; no component calls `fetch` directly. This is deliberate and is the
   repository's best structural asset — the fixture→API migration is genuinely localized to
   one file's twelve function bodies, plus the endpoints behind them.

3. **`Database.withHousehold` is the only sanctioned data door.** Its transaction-scoped GUC
   is what makes RLS work. Any code that bypasses it (a bare `PrismaClient`) silently loses
   isolation. CI greps for the escape hatch but **not** for bare `PrismaClient` construction.

4. **`authConfigFromEnv()` gates the entire application.** All eight `AUTH_*`/`APP_ORIGIN`
   variables are required with no defaults. Missing any one → middleware denies every
   non-public route and `/v1` returns 503. This is correct fail-closed design, and it means
   **environment configuration is a hard prerequisite for any end-to-end work.**

5. **`entitlements.plan` → `ActiveHousehold.plan` → nav + billing UI.** A one-way read today;
   any real entitlement enforcement must thread through the same layout transaction.

6. **`packages/contracts` shapes both sides.** Fixtures are deliberately shaped as API
   responses, so contract changes ripple to screens and endpoints simultaneously.

---

## D. Known technical debt

### D.1 Architectural debt

**D1 — There is no way to create a household.** *(highest-severity finding)*

Verified by exhaustive search: `household.create` / `householdUser.create` appear **only in
test files**. The application performs exactly two writes in its entire codebase, both in
`mirror.ts`: `users` and `user_profiles`.

The resulting journey for a genuinely new user:

1. Sign-up form → `setTimeout` → no account created (it is a mock).
2. Even with a real provider account: `mirrorIdentity` writes `users` + `user_profiles`.
3. No `household_users` row exists → `resolveRequestContext` throws `no-membership` (403).
4. `(app)/layout.tsx` redirects only on `unauthenticated`; `no-membership` propagates to the
   error boundary.
5. The user is permanently stuck on a generic error screen.

The auth boundary is excellent and currently guards a door with no room behind it.

**D2 — The demo is unreachable as checked out.** Verified live against the built app with
the documented default environment (`AUTH_*` empty, as `.env.example` ships them):

| Route | Result |
|---|---|
| `/`, `/sign-in`, `/sign-up` | 200 |
| `/dashboard`, `/onboarding`, `/obligations`, `/documents`, `/settings/billing` | **307 → `/sign-in`** |

The reachable surface is the landing page and three auth screens. The fourteen product
screens require a fully configured Supabase project *and* manually seeded household rows.
"Substantially working demo" is true of the *screens*; it is not true of the *application*.

**D3 — Multi-household users are locked out, and that is the target persona.** Server:
`>1 membership` + no header → 400 `ambiguous-household`. Client: `apiFetch` supports a
`householdId` option that **no caller ever passes**; no switcher UI exists. So a user in two
households gets a 400 on every `/v1` call and an error boundary on every page.

The PRD wedge is caregivers — precisely the people who would hold their own household *and*
a parent's. The architecture anticipated this correctly; the product never completed it.

**D4 — No outbox consumer.** ADR-005's transactional outbox is fully built, tested, and
called by nothing. There is no dispatcher process and no Redis client. Side-effect
architecture exists on paper and in `packages/db` only.

### D.2 Security / reliability risk

**S1 — CSP claims nonces, ships `'unsafe-inline'`.** `next.config.ts:5` states "CSP is
nonce-based in production". The emitted policy — confirmed on a live response — is
`script-src 'self' 'unsafe-inline'`. The word "nonce" appears nowhere else in the codebase.
This is a documented-but-false control, which is worse than a known gap: doc 12 §4 is cited
as though satisfied. `'unsafe-inline'` negates CSP's primary XSS protection.

**S2 — Production errors are silent.** Every server-side log is gated on
`process.env.NODE_ENV !== "production"` (`route.ts:135`, `sign-in/route.ts:86,104`). Combined
with zero observability tooling, a production 500 produces a generic problem+json to the
client and **no record anywhere**. Incidents would be undiagnosable.

**S3 — `users` / `user_profiles` have no RLS.** Verified: `app_user` reads all rows at any
scope. Deliberate and documented (enforcement is application-layer, and the one live query
does scope correctly). But the sole protection for every user's email is one `where` clause,
with no database backstop.

**S4 — Provider outage ends every session.** `/auth/refresh` catches all failures — including
a transient GoTrue 5xx — and clears both cookies. A brief provider blip logs out every
active user, who then cannot sign back in while it persists.

**S5 — No application-level rate limiting.** Auth throttling is entirely delegated to GoTrue.
`/v1` has none.

**S6 — CI does not fence bare `PrismaClient`.** The guardrail greps for
`unsafeAcrossAllHouseholds` and provider SDKs, but the invariant most likely to be violated
by ordinary feature work — constructing a `PrismaClient` instead of using `withHousehold` —
is unenforced.

### D.3 Medium-risk debt

- **UI test coverage is ~5%** (4 of 83 `.tsx` files). Security modules are well covered;
  product surface is nearly untested.
- **`provider.ts` and `api-client.ts` untested** — the two transport boundaries.
- **Fabricated email alias** shown to users while the real column sits unused in the provider.
- **False success toast on upload** — the UI affirms receipt of documents it discarded. This is
  a trust-damaging behaviour, not merely an unfinished one.
- **`no-membership` has no recovery route**, by explicit decision. Correct while household
  creation does not exist; becomes wrong the moment it does.

### D.4 Harmless cleanup

- `useItem` and `useMarkNotificationsRead` have zero consumers.
- `HouseholdSwitcher` is misnamed — it switches nothing.
- No Prettier/`.editorconfig`; formatting rests on convention.
- `REDIS_URL` documented in `.env.example` but read by no code.
- `CLAUDE.md` still states `apps/` is "not yet created" — the file that instructs every future
  engineer and agent is wrong about the repository's largest package.
- `ActiveHousehold.timezone/locale` are viewer values living on the household object (already
  acknowledged in-code as a known shape mismatch).

---

## E. Unknowns — not establishable from repository evidence

1. **Production runtime behaviour.** No deployment configuration exists and the app has never
   been deployed. Cold-start, connection-pool behaviour under Next.js serverless, and the
   `withHousehold` pinned-connection concern (flagged in `scoped.ts`) are all untested outside
   a single-process local server.
2. **Whether a Supabase project exists.** `.env.example` says "there is no Supabase project
   yet". Unverifiable here; no credentials are present, and none should be.
3. **Real GoTrue integration.** `provider.ts` has no tests and has never been exercised against
   a live provider in evidence I can see. Sign-in has never demonstrably worked end to end.
4. **Migration performance at scale.** The CLAUDE.md rule ("state lock impact, table size at
   100k households") has no recorded answers for the four existing migrations.
5. **Whether the G1 gate has been decided.** Dated ~2026-08-25; today is 2026-08-18.
6. **Design intent for multi-household UX.** The architecture supports it; no spec describes
   the switcher.
7. **Actual analytics requirements.** CLAUDE.md's definition of done requires "analytics
   wired"; no analytics exist and no spec names the events.

---

## F. Top 10 risks to becoming a reliable, polished product

Ranked by (probability × blast radius), highest first.

| # | Risk | Why it ranks here |
|---|---|---|
| **1** | **No household creation path** | The product is unusable by any new user. Everything else is cosmetic until this exists (D1) |
| **2** | **Fixture→API cutover is unbuilt and unsized** | 11 hooks, ~13 endpoints, storage, and a pipeline. This is the bulk of remaining work and is *feature construction*, not hardening |
| **3** | **Production is unobservable** | Errors are silently swallowed in production with no telemetry. First real incident is undiagnosable (S2) |
| **4** | **Never deployed** | No deployment config at all. Every production characteristic is unknown; serverless + pinned transactions is a known-risky combination the code itself flags |
| **5** | **Multi-household lockout hits the target persona** | Caregivers are the wedge and are exactly who breaks (D3) |
| **6** | **CSP is falsely documented as nonce-based** | A control believed to be in place is not. Undermines the security posture the product sells (S1) |
| **7** | **UI is ~5% tested** | The entire product surface can regress invisibly during hardening |
| **8** | **No entitlement enforcement** | Free-tier caps are decorative; revenue model is unenforceable, and the quota columns invite the belief that it works |
| **9** | **UI asserts false success** | Upload toasts "documents received" after discarding them; a fabricated forwarding alias is displayed. Directly corrodes the trust the product is selling |
| **10** | **Governance has drifted from reality** | `CLAUDE.md` misdescribes the repo; README says feature work is paused while 14 screens exist. Future contributors will be misled (S6 adds an unenforced invariant) |

---

## G. Recommended audit sequence

Your proposed order was UX → functionality/routing → architecture → security → entitlements →
Plaid. Based on what the evidence shows, I recommend **three changes**:

**Recommended order:**

1. **Identity & household lifecycle** *(new — promote to first)*
   The `no household creation` gap (D1) invalidates conclusions in every later audit: you
   cannot meaningfully audit UX, entitlements, or routing for a product no user can enter.
   This audit decides sign-up, household creation, invitation, and the multi-household model.

2. **Functionality & routing** *(promoted above UX)*
   Establish which flows are real, which are mocked, and what the endpoint surface must
   become. UX findings are only actionable once you know which screens have a backend.

3. **UX / UI**
   Now meaningful: real data shapes, real loading and error states, real empty states.

4. **Architecture & data model**
   The fixture→API cutover design, storage, outbox dispatcher, and the `(app)` layout's
   transaction boundary.

5. **Security & authentication**
   Deliberately *after* architecture: the auth boundary is the strongest part of the system
   and is unlikely to change, but new endpoints will add attack surface that should be
   reviewed once, at the end, rather than twice.

6. **Subscription & entitlement architecture**
   Requires (1) and (4) settled — quota enforcement needs a household and a document pipeline
   to meter.

7. **Plaid** *(recommend: convert to a scoping decision, not an audit)*
   There is no code. It contradicts `FOUNDING_PRINCIPLES` ("no credentials, no money movement
   — in v1") and `CLAUDE.md`'s postponement list. This should be a PRD §21 amendment
   discussion before any engineering audit is spent on it.

**Rationale for promoting identity above UX:** every other audit's findings are conditional
on a user being able to reach the product. Auditing UX first produces a backlog that must be
re-validated after the identity model lands.

---

## DO NOT TOUCH YET

Systems that must not be modified until the audits above have run. Each is either correct,
load-bearing, or both — and churn here costs more than it returns.

| System | Why | Unblocked by |
|---|---|---|
| **`packages/db/src/scoped.ts`** | The tenancy invariant. Verified fail-closed. The transaction-scoped GUC is subtle and easy to break silently | Audit 4 |
| **RLS migrations** | 14 tables under `FORCE` RLS, empirically proven. Any policy edit risks silent over-exposure | Audit 4 (with a migration plan) |
| **`middleware.ts` + `public-routes.ts`** | Deny-by-default with 82 tests. Adding a public path is a security decision, not a routing convenience | Audit 5 |
| **`server/auth/*`** (jwt, context, policy, session, pkce, csrf) | The strongest code in the repo, ~120 tests. Do not refactor for style | Audit 5 |
| **`server/http/route.ts` ordering** | The comment "THE ORDER IS THE CONTRACT" is literally true — CSRF → identity → household → authz → attribution. Reordering breaks A7 | Audit 5 |
| **`packages/contracts`** | Shapes both fixtures and future endpoints. Changing schemas now forces rework on both sides simultaneously | Audit 2 |
| **`lib/domain/queries.ts` signatures** | The cutover seam. Its *bodies* will change; its *signatures* must not, or all 14 screens churn | Audit 2 |
| **`entitlements` schema** | Columns are well designed. Do not add enforcement before the metering source (documents) exists | Audit 6 |
| **CI guardrails** | The scope fence and dispatcher allowlist encode governance decisions | Audit 4 |
| **Governing documents** | `FOUNDING_PRINCIPLES`, PRD, ADRs. Changes require their own amendment processes — except the factual `CLAUDE.md` repo-map error, which is a correction, not an amendment |

**Safe to correct at any time** (factual errors, not design): the `CLAUDE.md` repository map,
and the `next.config.ts` CSP comment — which should either be made true or made accurate.

---

## Verification appendix

Every claim above traces to a command run in this session:

- Gate: `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm test` (313) · `pnpm test:integration` (146)
- RLS: seeded on `DATABASE_ADMIN_URL`, read back on `DATABASE_URL` as `app_user`
  (`rolsuper=f`, `rolbypassrls=f`, tables owned by `autobureau`)
- Live routing: `next start` + `curl` against 8 routes and 2 endpoints, headers captured
- Code inventory: exhaustive `grep` for writes, `fetch`, `console`, `process.env`, provider SDKs
- Coverage: per-module source↔test mapping (an initial buggy `ls`-based pass under-reported
  and was corrected before publication)
