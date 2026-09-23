# ADR-009: The authenticated request boundary (session transport, household resolution, route protection, CSRF)

**Status:** Accepted (2026-08-14) · **Date:** 2026-08-14
**Amended:** 2026-08-14 — D5 added: the principal GUC and the phase-1 self-read policies that make D1
implementable, plus a database-enforced audit actor. D6 (audit domain-verb layer) and D7 (`jose`
authorization under PRD §12) added the same day. D8 (household-less identity audit) added
2026-08-15.
**Supersedes in part:** ADR-002 §Decision ¶1 (auth-session half only) · doc 01 §4.1 (same clause)
**Relates to:** doc 06 (authN/authZ) · doc 12 §4 (application security) · doc 03 §1 (API conventions) · PRD F1

## Context

F1 is specified across four documents that agree on the destination and disagree, or fall silent,
on four mechanics. Each silence is security-relevant: an implementer filling it by convention would
produce something that looks correct and is not. Reconnaissance against the repository at `8c43bec`
found the gaps below; this ADR closes them and nothing else.

The frozen inputs are not reopened here. Supabase Auth remains the provider (ADR-002; PRD §12 stack
freeze; doc 06 §1). RLS remains the second wall, tenancy-only (ADR-002 ¶3). `Database.withHousehold`
remains the single door to household data (review A1/F-01).

## Decision

### D1 — Household context is resolved server-side; a default exists only when it is unambiguous

`X-Household-Id` is a **candidate**, never authority. The resolver validates it against
`household_users` for the authenticated principal on every request (doc 03 §1, doc 06 §2).

When the header is absent:

- exactly one membership → that household is the context (doc 03 §1: "single-household users get a
  default");
- zero memberships → `403`;
- more than one membership → `400`; the request must name the household explicitly.

We do **not** infer a household from creation order, recency, or `households.created_by`. PRD §9
postpones multi-user logins, so v1 cannot produce a multi-household user through the product; the
ambiguous case is therefore unreachable in normal operation, and inventing a tie-breaker for it
would be inventing product behaviour. Failing closed matches the posture the data layer already
takes (`app.current_household()` NULL → zero rows; `ScopeError` on a malformed id).

### D2 — The session is established server-side; the browser never holds a token

Sign-in, magic-link redemption, and refresh are handled by our own origin. The server exchanges
credentials with Supabase Auth (server→server), receives the token pair, and sets the session
cookies itself: `HttpOnly; Secure; SameSite=Lax`, access ~1 h with rotating refresh (doc 06 §1).

This supersedes ADR-002 ¶1's "supabase-js is used client-side for auth session" and the identical
clause in doc 01 §4.1, for three reasons that are properties of the repository, not preferences:

1. **A browser-side SDK cannot write `HttpOnly` cookies.** Client-side session handling can only
   store the token in localStorage — which doc 06 §1 forbids in absolute terms ("No tokens in
   localStorage, ever") — or in a JS-readable cookie, which is the same exposure with extra steps.
2. **`connect-src 'self'` already forbids it.** The shipped CSP (`apps/web/next.config.ts`) permits
   no cross-origin connections, and `form-action 'self'` blocks the form-post variant. Relaxing CSP
   to admit the Supabase origin would weaken a live control to satisfy a mechanic we do not need.
3. **It improves the escape hatch we already committed to.** Doc 14 requires auth stay
   JWT-compatible so a GoTrue/WorkOS migration is possible "without token-format change". Owning
   the session endpoints makes the provider swappable behind our own boundary.

ADR-002's *purpose* is untouched: the browser still never queries the database, and we still do not
build authentication ourselves — Supabase remains the credential store, password policy engine, and
token issuer.

### D3 — Two-layer route protection, deny-by-default

- **Middleware — authentication gate only.** Deny-by-default matcher over the whole app with an
  explicit public allowlist: `/`, `/sign-in`, `/sign-up`, `/forgot-password`, and framework static
  assets. Everything else — including `/onboarding`, which CJ-1 places after signup — requires a
  session. It verifies the cookie's JWT signature and expiry (JWKS, cached) and nothing more:
  unauthenticated HTML routes redirect to `/sign-in`, unauthenticated `/v1` returns `401`
  problem+json. It performs no database access.
- **Resolver — authorization context.** Membership lookup, role, and `RequestContext` are resolved
  in the request tier (server components and `/v1` handlers) through one shared function, because
  that is where a pooled database connection legitimately exists and where doc 06 §2's Redis-cached
  membership check belongs.

Identity is **never** carried from middleware to the application in request headers. Any inbound
header that looks like injected identity is ignored; the resolver derives identity from the cookie
each time. Doc 06 §2's "handlers never re-derive identity" means handlers do not hand-roll it —
they receive it from the shared resolver, which is a different thing from trusting a header.

The middleware runtime (edge vs node) is left to implementation; it is not load-bearing for any
invariant here, because the middleware layer touches no database and holds no authority beyond
"there is a valid, unexpired session."

### D4 — CSRF: same-site cookie plus a mandatory custom header on every unsafe method

Doc 12 §4 requires "same-site-cookie + custom-header checked" on all state-changing routes. Frozen
as: cookies `SameSite=Lax` (doc 06 §1 — `Strict` would break magic-link and OAuth returns, which
are top-level cross-site navigations that must carry the session), plus a dedicated request header
required on **every** unsafe method — `POST`, `PUT`, `PATCH`, and `DELETE` — rejected with `403`
problem+json when absent. `Origin` is additionally checked when present.

Two rejections:

- **Do not overload `Idempotency-Key` or `X-Household-Id`.** Both are semantic headers, both are
  conditional — `apps/web/src/lib/api-client.ts` omits `Idempotency-Key` on `DELETE`, which would
  leave the destructive method the only one unprotected. A CSRF signal must be unconditional, so it
  gets its own header.
- **Do not introduce a synchronizer token.** Doc 12 §4 does not ask for one. With `SameSite=Lax`
  cookies, `credentials: "same-origin"`, and no CORS allowlist, a cross-site attacker can neither
  set a custom header from an HTML form nor survive preflight from `fetch`. A token would add
  server-side state for no additional property.

### D5 — A principal GUC and two phase-1 self-read policies; the audit actor is enforced by the database

**Amendment (2026-08-14).** D1 as written above is not implementable against the shipped policy set,
and this was measured, not inferred: `household_users` is scoped by
`household_id = app.current_household()`, so `app_user` reading it with no household scope returns
**zero rows** — via Prisma and via raw SQL alike. D1 needs to *count* a principal's memberships
before any household is chosen, and doc 03 §2's `/v1/me` ("profile + memberships") and
`/v1/households` ("list mine") need the same enumeration. The only workaround available today —
scope to the candidate, then check — cannot run at all when there is no candidate, and violates A7
when there is one.

**The request runs in two phases, and the database can tell them apart.**

*Phase 1 — principal-only resolution.* A second transaction-local setting, `request.user_id`, is
established with no household set. Read through `app.current_user_id()`, defined exactly like
`app.current_household()` (`NULLIF(current_setting(..., true), '')::uuid`), so an unset principal is
NULL and every predicate keyed on it evaluates to NULL — the same fail-closed posture. Two
**SELECT-only** policies are added; the existing policies are not modified:

```sql
CREATE POLICY self_membership_read ON household_users FOR SELECT
  USING (user_id = app.current_user_id() AND app.current_household() IS NULL);

CREATE POLICY self_households_read ON households FOR SELECT
  USING (app.current_household() IS NULL AND EXISTS (
    SELECT 1 FROM household_users hu
    WHERE hu.household_id = households.id AND hu.user_id = app.current_user_id()));
```

*Phase 2 — household-scoped work.* Once a household is validated and set, both settings are live.

**The `app.current_household() IS NULL` guard is load-bearing, not defensive styling.** Postgres
policies are permissive and OR together. Without the guard, phase 2 returns the *union* of the
selected household's members and the principal's memberships elsewhere — measured as 3 rows where 2
were correct, the extra row being the principal's own membership in another household. It is not a
cross-user leak (another user's foreign membership stayed invisible), but it silently falsifies the
rule that everything visible under household scope belongs to that household, and code written
against that rule would be wrong in a way tests rarely catch. With the guard, the self-read policies
switch off the instant a household is selected: 2 rows, zero rows outside the selected household.

**A7 is preserved, not amended.** Validation happens in phase 1, before any household GUC exists;
the household setting is only ever assigned a household the principal is already known to belong
to. A forged candidate is rejected in phase 1 and never opens a scope.

**The audit actor becomes a database constraint.** `audit_log.actor_id` defaults to
`app.current_user_id()`, and a check constraint requires user-attributed rows to carry one:

```sql
ALTER TABLE audit_log ALTER COLUMN actor_id SET DEFAULT app.current_user_id();
ALTER TABLE audit_log ADD CONSTRAINT audit_user_actor_requires_id
  CHECK (actor_type <> 'user' OR actor_id IS NOT NULL) NOT VALID;
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_user_actor_requires_id;
```

This converts FOUNDING_PRINCIPLES invariant 9 from a convention a handler author can forget into
something Postgres refuses: a user-attributed audit row cannot be written without an authenticated
principal. Background work is unaffected — `actor_type='system'` rows insert with no principal, as
the dispatcher and deletion-cascade jobs require. The domain-verb enrichment described in doc 02 §9
(`obligation.dismissed` rather than `obligation.updated`) rides on top of this floor and is a
separate decision, still open.

**Two properties this does *not* claim.** The principal GUC is not a second gate on household data —
a caller setting only the household setting reads that household exactly as it does today; the
principal setting enables phase-1 enumeration and the audit default, nothing more. And phase 2 still
exposes the selected household's full member list, which follows from the pre-existing
`household_isolation` policy and is required for member management (doc 06 §3). Both are
within-tenant, and neither is introduced here.

**Migration note.** `audit_log` is among the largest tables at 100k households (doc 02 §10). The
constraint must be added `NOT VALID` and validated in a second statement, or the `ADD CONSTRAINT`
takes an ACCESS EXCLUSIVE lock for a full table scan. Both forms were exercised.

**Rejected: a `SECURITY DEFINER` membership lookup.** A definer function taking a user id would need
no policy changes, but it has no principal to check its argument against — `app_user` calling it
with *any* user id returned that user's memberships in the probe. That moves membership authorization
into the application layer alone, which is the exact class of bug RLS exists to backstop (ADR-002
¶3), and it creates a privilege-bypass primitive that the CI grep for `unsafeAcrossAllHouseholds`
cannot see.

### D6 — The audit domain-verb layer: infrastructure observes and enforces, infrastructure persists

**Amendment (2026-08-14).** D5 froze the floor: every user mutation produces an attributed row, with
Postgres refusing an unattributed one. D6 settles the layer above it — when a row must carry a
domain verb (`obligation.dismissed`) rather than the CRUD-derived action (`obligation.update`).

**A mechanical constraint shapes this, and it was measured.** Doc 01 §4.5 states that the audit row
is written "via a Prisma client extension". In Prisma 6 that is impossible: inside a `query`
extension, `this` is `{'0': …}` and `Prisma.getExtensionContext(this)` exposes no model delegates,
so the hook has no handle on the enclosing interactive transaction and cannot write anything. The
work therefore splits across two pieces of infrastructure, neither of which is a handler author:

- **The extension observes and enforces.** It intercepts mutating operations, refuses to proceed
  when no actor context is in scope, refuses to proceed when the operation requires a domain verb
  and none was declared, and records the intended row into the ambient context.
- **The scoped wrapper persists.** `withHousehold` owns the transaction, so it flushes the recorded
  rows before commit. A handler cannot skip the flush because it does not own the transaction.

Verified end to end on a disposable database (20 checks, no failures): the floor writes one row per
mutation with the actor stamped by the D5 default; a declared verb replaces the CRUD action; a
required verb omitted **rejects the mutation and leaves the domain row unchanged**; absent actor
context rejects likewise; the audit rows roll back with the domain write; reads are not audited; and
two mutations in one unit of work produce two rows.

**A domain verb is required in exactly three cases**, each traceable to an existing requirement:

1. **Lifecycle transitions where one CRUD operation maps to several user-meaningful outcomes** —
   dismiss, complete, reopen all being `obligation.update`. Doc 02 §9's own example
   (`obligation.dismissed`) is this case.
2. **Privileged operations** — the owner-only rows of doc 06 §3: member management, alias rotation,
   household deletion, export.
3. **Security-sensitive actions the extension cannot observe.** `secret.revealed` (doc 12 §5.3,
   PRD §13/F8) is a *read*; no write-interceptor will ever see it. An explicit audit API is
   therefore a necessity, not a convenience — and it is the only sanctioned way to write a row the
   extension did not generate.

**Everything else stays CRUD-level.** An ordinary create or a field edit is fully and honestly
described by `item.create`; inventing a verb for it would grow a taxonomy nobody reads.

**The catalogue lives in `packages/contracts`, beside `EVENT_TYPES`.** That registry already exists
with exactly the governance this needs ("adding an event type is a contracts PR"), `packages/db`
already depends on contracts, and `outbox.ts` already imports from it — so this costs no new wiring.
Two of doc 02 §9's three example actions (`obligation.dismissed`, `export.requested`) are already
`EVENT_TYPES` members, so most of the vocabulary exists.

It is nonetheless a **separate registry**, not a reuse of `EVENT_TYPES`: the two measure different
axes. Not every event is user-caused (`reminder.due`, `radar.completed`), and not every audited
action emits an event — `secret.revealed` has no async consumer, and adding it to the outbox
taxonomy would imply a subscriber that does not exist. Same dotted `aggregate.verb` convention,
different list.

**Enforcement is data, not discipline.** The set of `Model.operation` keys that may not fall back to
a CRUD action is a typed constant; the extension throws when one of them runs with no verb in scope.
A handler cannot silently omit a required verb, because the write fails.

**Actor identity does not come from the ambient context.** The context carries the household, the
optional verb, and the pending rows; `actor_id` is stamped by the database default from the
principal setting (D5). A bug in context propagation therefore cannot forge an actor — it can only
fail closed.

Deliberately still open, and not needed for F1: the `meta` diff shape for sensitive mutations
(doc 02 §9, doc 10 §3 PII scrubbing). The floor and the verb layer do not depend on it.

### D7 — `jose` is authorized as a runtime dependency for JWT/JWKS verification

**Amendment (2026-08-14).** PRD §12 freezes the stack and admits "no new vendors or runtime
dependencies without ADR". This is that ADR entry.

`jose` is a **dependency, not a vendor**: no service, no account, no data leaves the process, so
doc 01 §5's "one throat to choke" vendor test does not apply — only PRD §12's dependency clause.

Verified at authorization time: **`jose@6.2.8`, MIT, zero runtime dependencies and zero peer
dependencies.** Its export map resolves to a WebCrypto (`webapi`) build rather than a Node-specific
one, so it runs unchanged on Node and Edge — which keeps D3's deliberately-open middleware runtime
open. Nothing equivalent exists in the dependency tree today.

It supplies exactly the F1 surface and no more: `jwtVerify` with explicit `issuer`, `audience`, and
`algorithms`; `createRemoteJWKSet` for doc 06 §2's cached JWKS verification; and
`createLocalJWKSet` with `generateKeyPair`/`exportJWK` so the verification path is testable with
fixture-signed tokens and no live provider.

**Rejected: hand-rolling verification.** Algorithm confusion and `alg: none` handling are the
recurring CVE class in hand-written JWT code. A zero-dependency library built on the platform's own
crypto is the smaller risk, and the repository's hand-rolled-over-dependency instinct (the icon set)
does not extend to signature verification.

**Rejected: `@supabase/supabase-js`.** The Auth exchange D2 requires is documented server-to-server
REST reachable with `fetch`. Avoiding the SDK keeps D2's provider-portability claim (doc 14: migrate
"without token-format change") real rather than aspirational.

**Binding constraint on the implementation.** The verification module stays provider-agnostic: pin
the accepted `algorithms` explicitly, verify `issuer`, `audience`, and expiry explicitly, and never
take the algorithm from the token header. Supabase populates the configuration; it is not named in
the module.

### D8 — Identity mirroring, and the one household-less audit row it needs

**Amendment (2026-08-15).** A Supabase-authenticated principal has no rows in this database.
`household_users.user_id` is a foreign key to `users.id`, so until something mirrors the principal
in, every request from a perfectly valid session resolves to `403 no-membership`. Mirroring is
therefore not a convenience — it is the step between "the session works" and "the product works".

Mirroring is a state mutation, so **FOUNDING_PRINCIPLES invariant 9 requires an audit row for it**.
It happens before any household exists, and `audit_insert` checks
`household_id = app.current_household()`, which no NULL household can satisfy. Invariant 9 was
therefore *unsatisfiable* for identity writes — refused by policy, not merely awkward.

**One additional INSERT policy, and nothing else:**

```sql
CREATE POLICY self_audit_insert ON audit_log FOR INSERT
  WITH CHECK (household_id IS NULL AND actor_id = app.current_user_id());
```

`audit_insert` is untouched. Policies are permissive and OR together, so this adds one narrow
alternative: a household row with a matching household, or a household-less row for the acting
principal. A household-less row for *someone else*, or a foreign household, satisfies neither.

**Why this is not a tenancy hole.** It admits rows carrying no household, so there is no tenant to
cross into. It grants no read: `audit_read` still requires `household_id = app.current_household()`,
and NULL is never equal to a household, so these rows are write-only to `app_user`. And it cannot
forge attribution — `actor_id` defaults to `app.current_user_id()` (D5) and the CHECK compares the
*resulting* row against that same setting, so a caller supplying another id is rejected rather than
silently corrected.

**`Database.withIdentity` is deliberately separate from `withPrincipal`.** Phase-1 resolution stays
read-only by construction, because deciding which household a request belongs to is not a moment
that should change rows; quietly making it writable would remove a guard rather than add a
capability. `withIdentity` is the one operation that legitimately writes with no household in scope.

**Where mirroring runs:** once, when a session is established — sign-in and callback — not on every
request. Both routes verify the access token *before* storing it, which proves the provider's
issuer, audience and algorithm are acceptable at sign-in rather than on the next request, and is the
only trustworthy source for the subject and email. Cookies are issued only after mirroring succeeds:
a session whose identity is absent from this database is a partially usable identity, which is
exactly what must not be created.

**Concurrency is left to Postgres.** Two simultaneous first logins race; the writes lean on
`users.id` and `user_profiles.user_id` through `INSERT … ON CONFLICT DO NOTHING`. An
application-level mutex would be a second, weaker copy of a guarantee the database already gives.

**Rejected, as in the original analysis:** privileged mirroring in the request path (violates doc 06
§5's confinement of `service_role` to migrations and two named jobs); an auth webhook → outbox →
dispatcher (architecturally respectable, but it buys eventual consistency at exactly the wrong
moment — first login — and a lost webhook strands a user at 403 with no self-service recovery);
and declaring identity mutations outside invariant 9 (a rationalisation, not a decision).

**Consequence recorded honestly:** `user_profiles.display_name` is `NOT NULL` with no default, and
no governing document says what a mirrored profile is called. The verified email address is used as
the initial value — the only thing the system actually knows at that moment — and onboarding and
profile settings replace it. If the census (PRD F3) should own that value instead, this is the line
to change.

## Consequences

- ✅ The four gaps that would have been filled by convention are now filled by decision, each with
  an acceptance test attached (doc 11 §3 style: the invariant, not the implementation).
- ✅ D5 makes D1 implementable as frozen, and unblocks `/v1/me` and `/v1/households`. Verified
  against real Postgres before adoption: 33 checks, no failures, on a disposable database.
- ✅ CSP is unchanged. No control is weakened to make authentication convenient.
- ⚠️ `apiFetch` must attach the CSRF header on `DELETE` as well as the other unsafe methods; the
  current conditional is an F1 implementation task.
- ⚠️ Storage signed URLs (Phase 2E) are cross-origin and will need a scoped `connect-src`/`img-src`
  addition. Recorded here so it is a decision then, not a surprise.
- ❌ Rejected: client-side supabase-js session (D2 ¶1–2); localStorage or JS-readable cookie
  storage (doc 06 §1); trusting `X-Household-Id` without a membership check (doc 03 §1); inferring
  a household when membership is ambiguous (D1); protecting routes by naming convention rather than
  a deny-by-default matcher (D3); encoding roles into RLS policies — the GUC carries a household,
  not a principal, so role authorization stays in `can()` (ADR-002 ¶3, doc 06 §3).

## Acceptance tests (must pass before F1 is complete)

| # | Invariant | Test |
|---|---|---|
| A1 | The header is a candidate, not authority | Member of A sending `X-Household-Id: B` → `403`, and no scope is opened |
| A2 | Unambiguous default only | One membership + no header → that household; two memberships + no header → `400`; zero → `403` |
| A3 | No token reaches the browser | Session cookies are `HttpOnly; Secure; SameSite=Lax`; no token in `localStorage`, `sessionStorage`, or any client bundle |
| A4 | Deny-by-default | Every non-allowlisted route without a session redirects or `401`s; the allowlist is asserted explicitly, not inferred |
| A5 | Identity is not header-injectable | A request carrying forged identity-shaped headers resolves to the cookie's principal, or is rejected |
| A6 | CSRF | Every unsafe method without the custom header → `403`, `DELETE` included |
| A7 | Ordering | The scope GUC is set only after membership validation succeeds |
| A8 | No privileged credential in the browser | Production bundle contains no `DATABASE_ADMIN_URL`, `service_role`, or connection string |
| A9 | Phase 1 enumerates only the principal's own memberships | Single → 1, zero → 0, ambiguous → 2; another user's rows → 0; phase 1 returns no household data (items → 0) |
| A10 | Phase 2 admits no union | Unfiltered `household_users` under a household scope returns that household's members only; the principal's memberships elsewhere are absent |
| A11 | The audit actor is enforced by the database | `actor_id` defaults to the principal; a `user` row without a principal is rejected; a `system` row without a principal is accepted |
| A12 | Self-read policies do not widen writes | Phase-1 self-grant of a membership rejected; phase-1 role escalation affects 0 rows |
| A13 | The audit floor cannot be bypassed | A mutation with no actor context in scope is rejected; no domain row and no audit row is written |
| A14 | A required domain verb cannot be omitted | A mutation on a verb-required operation without a declared verb is rejected, domain row unchanged |
| A15 | Audit is atomic with the domain write | A unit of work that fails after mutating leaves neither domain nor audit rows; two mutations produce two rows; reads produce none |
| A16 | Audit-only actions are recordable | `secret.revealed` — an action no write-interceptor can observe — is written through the explicit API with the actor still DB-stamped |
| A17 | JWT verification is complete and pinned | Valid token verifies; invalid signature, expired, wrong issuer, wrong audience, unpinned algorithm, and malformed claims each fail |
| A18 | A principal may audit its own household-less work | A `NULL`-household row is written with `actor_id` stamped by the database; a failure inside the unit leaves neither the identity rows nor the audit row |
| A19 | The exception cannot be widened into a hole | A `NULL`-household row claiming another actor is refused; a foreign household from an identity scope is refused; `NULL`-household rows are invisible to household-scoped and principal-scoped reads |
| A20 | The household-scoped audit path is unchanged | Household work still records its household and actor; a cross-household audit row is still refused |
