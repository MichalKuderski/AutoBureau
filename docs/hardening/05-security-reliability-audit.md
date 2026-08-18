# AutoBureau — Security & Reliability Audit

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Scope:** Read-only. No production behaviour modified. **No secret values are reproduced in this document.**

---

## Method

Security-critical modules were read in full rather than sampled: `session.ts`, `pkce.ts`,
`jwt.ts`, `context.ts`, `policy.ts`, `csrf.ts`, `provider.ts`, `mirror.ts`, `problem.ts`,
`route.ts`, `middleware.ts`, all four migrations, and every auth route handler.

Where a conclusion could be tested, it was tested against a live PostgreSQL instance with RLS
genuinely applying (`app_user`: not superuser, not owner, `NOBYPASSRLS`) or against a running
production build.

**One hypothesis I formed was wrong, and the test corrected it.** I predicted that an email
collision during identity mirroring would silently issue a working-looking session. It does
not — the follow-on foreign key rejects it and the transaction rolls back. The finding below
reports what actually happens, which is materially different and much less severe. Recording
this because the same class of assumption, published unverified, is how audits mislead.

---

## Special analysis: the session-refresh behaviour

You asked that this not be assumed broken merely because it is complex. **It is not broken.
It is correct, and it is better reasoned than most production implementations.** Here is what
actually happens.

**The mechanism, traced end to end:**

1. Both cookies are issued `HttpOnly; Secure; SameSite=Lax; Path=/` with a **30-day
   `Max-Age` — the session's lifetime, deliberately not the access token's.**
2. The JWT's `exp` is the sole authority boundary, verified on **every** request by both
   middleware and the `/v1` boundary, with **zero clock tolerance**.
3. Middleware, on a verification failure: if the reason is `expired` **and** a refresh cookie
   is present **and** the path is not `/v1`, it redirects to `/auth/refresh?next=…`.
4. `/auth/refresh` is a `GET` — necessarily, because `SameSite=Lax` sends cookies on top-level
   navigations and nothing else would work. It rotates server-side, sets new cookies, and 303s
   to a `safeDestination()`-validated same-origin path.
5. For `/v1` paths an expired token is a **401, never a redirect**, so an in-flight XHR is not
   corrupted by a redirect chain.

**Why the design is right, specifically:**

- **The loop guard is structural, not a counter.** Middleware redirects to refresh *only when a
  refresh cookie exists*; `/auth/refresh` clears **both** cookies on any failure. A failed
  refresh therefore removes the very condition that triggers the redirect, and the next pass
  falls through to sign-in. Nothing is remembered between requests, which is what lets
  middleware stay free of state. This is a genuinely elegant solution to a problem most
  implementations solve with a fragile attempt counter.
- **`safeDestination()` refuses `/auth/refresh` as a destination**, so a *successful* refresh
  cannot bounce back into itself either. Both loop directions are closed.
- **The cookie-lifetime decision is correct and was arrived at by fixing a real bug.** Commit
  `431a194` shows the access cookie was originally scoped to `expires_in`. That was a defect:
  a browser deletes a cookie the moment `Max-Age` lapses, so the state the refresh redirect
  exists to detect — *an expired token still present* — could never arise. Middleware saw no
  cookie, denied at its first check, and the 30-day refresh token sat unused. Sessions ended
  hourly at `/sign-in`. **A cookie outliving its token confers nothing: it is an envelope, not
  a credential**, because `exp` is still checked on every request.
- **CSRF on the refresh GET is correctly analysed, not overlooked.** A hostile page can
  navigate a victim to `/auth/refresh` and force a rotation. The consequence is a rotated token
  and a redirect to a validated same-origin path — a nuisance, not a compromise. No custom
  header is required because no browser sends one on a navigation. I agree with this analysis.

**The one thing genuinely wrong with the session story is not the refresh design.** It is
that **nothing can end a session** — see P0-1. Refresh is sound; revocation is absent.

---

# P0 — Critical

## P0-1 · Sessions cannot be terminated, and the refresh token stays valid for 30 days

**Evidence.** `components/layout/nav.tsx:153` renders sign-out as `<Link href="/sign-in">`.
Exhaustive search confirms **no code in the application calls `POST /v1/auth/sign-out`** — the
endpoint exists, is CSRF-protected, calls `provider.signOut()`, and clears both cookies. It is
orphaned. There is no other revocation path: no session table, no token denylist, no
"sign out everywhere" implementation (that button has no `onClick` at all).

**Exploit / failure scenario.** A caregiver signs in on a shared family tablet, finishes, and
presses sign out. They are navigated to `/sign-in`; **both cookies remain set and valid**.
The next person to use the tablet types `/dashboard` and is inside the account — passports,
insurance policies, medical accounts, the household's entire document registry. Because
`provider.signOut()` is never reached, the refresh token also remains valid **at the provider**
for its full lifetime, so even clearing browser cookies afterwards does not revoke it. There is
currently **no mechanism by which a user or an operator can end a session.**

This is the highest-severity finding in the product: it combines a false affordance with the
complete absence of revocation, in a product built around shared devices.

**Remediation.** Convert to a `<button>` posting to `/v1/auth/sign-out` via `apiFetch`, then
`router.replace("/sign-in")` + `router.refresh()`. Independently, implement "sign out
everywhere" against the provider's global-logout scope.

**Regression risk: Low.** Isolated component; the endpoint is built and tested. The deliberate
trade-off recorded in the current comment — a `<button>` loses middle-click/open-in-new-tab —
is the correct loss.

**Tests to add.** E2E: sign in → sign out → navigate to `/dashboard` → asserts redirect to
sign-in. Integration: sign-out clears both cookies and calls the provider even when the
provider errors.

---

## P0-2 · CSP is documented as nonce-based and ships `'unsafe-inline'`

**Evidence.** `next.config.ts:5` states *"CSP is nonce-based in production."* The emitted
header, **captured from a live response** on a running production build, is:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; …
```

The string `nonce` appears **nowhere else in the codebase**. The reason `unsafe-inline` is
present is a single inline script: `app/layout.tsx:34` injects `themeInitScript` via
`dangerouslySetInnerHTML` to prevent a theme flash before first paint.

**Exploit / failure scenario.** `script-src 'unsafe-inline'` negates CSP's primary purpose. Any
successful injection of inline script content — through a rendered document title, an extracted
field, a vendor name, an AI-derived value, or a future rich-text surface — executes with full
page privileges. Because session cookies are `HttpOnly`, the attacker cannot read the token
directly, but they can act as the user through the authenticated origin: read the entire
household registry via `/v1`, and issue state-changing requests, since `apiFetch`'s CSRF header
is trivially reproducible from same-origin script. **The document pipeline this product is
built to add ingests adversarial input by design** (`FOUNDING_PRINCIPLES`: "documents are
untrusted input"), which is precisely when this control needs to be real.

The worse harm is epistemic: doc 12 §4 is cited as satisfied. A control believed present but
absent is more dangerous than a known gap, because nobody compensates for it.

**Remediation.** Generate a per-request nonce in middleware, pass it to the layout, apply it to
the one inline script, and drop `unsafe-inline` from `script-src`. Keep `style-src
'unsafe-inline'` if Tailwind requires it — that is a far smaller exposure and should be stated
honestly rather than described as nonce-based. Until then, correct the comment.

**Regression risk: Medium.** Nonce plumbing touches the root layout and middleware; a mistake
breaks the theme script or blocks Next's own inline bootstrap. Requires verification of Next
15's inline-script needs in production mode.

**Tests to add.** A response-header assertion that `script-src` does not contain
`'unsafe-inline'` in production, and an E2E check that theming still applies before paint.

---

## P0-3 · The two-step verification toggle is fictional

**Evidence.** `settings/profile/profile-settings.tsx` — `useState` boolean plus a toast reading
*"Two-step verification on — You'll be asked for a code on new devices."* There is **no MFA
implementation anywhere**: `provider.ts` exposes only `signInWithPassword`, `refresh`,
`signOut`, `requestMagicLink`, `exchangeCode`. No enrollment, no challenge, no factor storage.

**Exploit / failure scenario.** This does not create a vulnerability so much as *induce the
user to accept one*. A security-conscious user enables 2FA, receives explicit confirmation, and
reasonably relaxes about password reuse on an account holding identity documents. Their account
is protected by a password alone. An attacker with credentials from an unrelated breach
succeeds against an account the user believes requires a second factor. The state does not even
survive a reload.

**Remediation.** Remove the control, or render it disabled with honest copy, until GoTrue MFA
enrollment is wired. A disabled control that tells the truth is strictly better than an active
one that lies.

**Regression risk: None** for removal or disabling.

**Tests to add.** Once implemented: enrollment, challenge-on-new-device, and recovery-code
paths.

---

## P0-4 · Production emits no security telemetry whatsoever

**Evidence.** Every server-side log is gated:

```
server/http/route.ts:135        if (process.env.NODE_ENV !== "production") console.error("[v1]", cause);
app/v1/auth/sign-in/route.ts:86,104   same gate
```

No Sentry, no OpenTelemetry, no structured logger, no analytics anywhere in the codebase. The
`audit_log` table is well designed and DB-enforced, but almost nothing writes domain rows to it
because there are no domain endpoints.

**Exploit / failure scenario.** Credential stuffing, token-verification failures, CSRF
rejections, cross-tenant access attempts via `X-Household-Id`, and repeated 403s all produce
**no record of any kind**. There is nothing to alert on, nothing to rate-limit against, and
nothing to reconstruct an incident from. An attacker probing the boundary is invisible. When
the first real incident occurs, the investigation begins with zero evidence.

P1-1 below is a concrete demonstration: a specific, reproducible user-facing 500 that leaves no
trace in production.

**Remediation.** A structured logger that runs in production; error reporting; and security
events (auth failure, CSRF rejection, `not-a-member`, `no-membership`, 403s) emitted with
correlation IDs. The `traceparent` column already in the outbox schema anticipates this.

**Regression risk: Low**, with one caution — log redaction must be designed alongside, or this
finding converts into a PII-in-logs finding. Never log tokens, cookies, `item_secrets`
contents, or provider response bodies.

**Tests to add.** Assert that no log line contains a token, a cookie header, or a provider body.

---

## P0-5 · The product asserts encryption that does not exist

**Evidence.** `item_secrets` has `ciphertext Bytes` and `keyVersion Int`. **No encryption or
decryption code exists anywhere in the repository** — an exhaustive search for
`encrypt|decrypt|pgp_sym|aes|kms` returns only comments and the `jose` import note. ADR-007 is
entirely unimplemented. Meanwhile **five user-facing surfaces** state it as present-tense fact:

| Location | Claim |
|---|---|
| `settings/privacy` | *"Passport and account numbers are encrypted; even our own systems that read documents cannot decrypt them."* |
| `household-screen:240` | *"Stored encrypted. Revealing a full number is recorded in your activity log."* |
| `documents/upload:87` | *"encrypted and never shown in full"* |
| `onboarding/document:81` | *"Identity numbers are stored encrypted"* |
| `settings/privacy:100` | *"Encrypted backups age out within 35 days"* |

**Exploit / failure scenario.** No exploit today — there is no data, because nothing writes
`item_secrets`. The exposure is that the moment the document pipeline lands, identifier-grade
PII will be written by code whose surrounding UI already promises field-level encryption, in a
codebase where nothing enforces it. This is exactly the sequence in which a product ships
plaintext passport numbers while its own settings screen assures the user otherwise. It is also
the claim most likely to be quoted back in a security review or a dispute.

**Remediation.** Move all five to commitment tense until ADR-007 is implemented. Add a CI fence
that fails if any code writes `item_secrets.ciphertext` without going through an encryption
module. Implement ADR-007 before the first identifier-grade value is stored.

**Regression risk: None** — copy changes only.

**Tests to add.** With implementation: round-trip encrypt/decrypt, key-version rotation, and an
assertion that the AI runtime role holds no decrypt grant.

---

## P0-6 · Account deletion and data export are no-ops that report success

**Evidence.** `settings/privacy/privacy-settings.tsx` — both actions terminate in a toast.
*"Deletion scheduled — Sign in within 14 days to undo. We've emailed you the details."* No
request, no email, no scheduling. No deletion cascade exists.

**Failure scenario.** A user exercising an erasure right is told it is in progress. It is not.
Once real users exist this is a regulatory exposure (GDPR Art. 17, CCPA) rather than a bug,
and it is aggravated by `FOUNDING_PRINCIPLES` naming deletion a first-class workflow and by the
adjacent copy *"Deletion is real — we tell you exactly what happens and when."*

**Remediation.** Until the cascade exists, the flow must not claim completion — disable with
honest copy or route to a support path.

**Regression risk: None** for making it honest.

**Tests to add.** With implementation: cascade completeness across all 14 household-scoped
tables, and verification that the dispatcher role is the only one able to perform it.

---

# P1 — Significant security and reliability

## P1-1 · An email collision produces an unlogged 500 and a permanently unusable account

**Evidence — tested, and this corrected my initial hypothesis.** `users.email` is `UNIQUE`.
`mirrorIdentity` uses `createMany({ skipDuplicates: true })` → `ON CONFLICT DO NOTHING`, which
swallows the **unique-email** conflict as well as the primary-key one. Executed against the
live schema:

```
subA (existing, collide@example.com)  → INSERT 0 1
subB (new sub, SAME email)            → INSERT 0 0        ← silently skipped
user_profiles insert for subB         → ERROR: violates foreign key constraint
                                         "user_profiles_user_id_fkey"
```

I expected a silent false success. **It is not silent** — the follow-on FK rejects it and
`withIdentity` rolls back entirely. That is the correct, fail-closed outcome and it deserves
credit.

What happens next is the defect. The thrown error is a Prisma error — neither `TokenError`,
`MirrorError`, nor `ProviderError` — so `sign-in/route.ts` falls through to
`problemResponse("internal")`: a **500 "Something went wrong on our side."** And because of
P0-4, `console.error` is gated off in production, so **nothing is recorded anywhere**.

**Failure scenario.** A user signs up with a password, later returns and signs in with Google.
If the provider issues a different `sub` for the same verified address rather than linking
accounts, that user receives an opaque 500 on **every** subsequent sign-in attempt, forever,
with no server-side trace. Support has nothing to work from. `oauth-options.tsx` assumes the
provider links by verified email; `provider.ts` states plainly that **provider compatibility is
unverified** because no project exists.

**Remediation.** Catch the unique-violation explicitly and return a specific, non-enumerating
problem (`conflict`) with a distinct log event. Longer term, decide the account-linking policy
explicitly rather than inheriting whatever GoTrue is configured to do.

**Regression risk: Low** — a new catch branch in one function.

**Tests to add.** Integration: two principals, same email, different `sub` → asserts a
deterministic non-500 outcome and no partial write. **This case is absent from the 14 existing
mirror tests**, which cover same-`sub` idempotency and concurrency well.

## P1-2 · No timeout on any outbound provider call

**Evidence.** All three `fetchImpl` call sites in `provider.ts` (`/token`, `/otp`, `/logout`)
pass no `signal` and no `AbortSignal.timeout`.

**Failure scenario.** A hung or degraded GoTrue holds the request open until the platform's own
timeout. Sign-in, refresh, and magic-link all block. Combined with the interactive-transaction
connection pinning described in the architecture review, a slow provider converts into
saturated request capacity — a dependency outage becomes an availability outage. `signOut` is
documented as best-effort but is still `await`ed, so a hung provider delays sign-out too.

**Remediation.** `AbortSignal.timeout(…)` on every provider call, with `unavailable` on abort.

**Regression risk: Low.** Choose the value deliberately; too tight will fail slow mobile
networks on legitimate sign-ins.

**Tests to add.** A provider stub that never resolves → asserts a bounded `unavailable`.

## P1-3 · Refresh cannot distinguish a provider outage from a revoked token

**Evidence.** `/auth/refresh` catches everything and calls `abandon()`, clearing both cookies.
`provider.ts` already classifies `unavailable` separately from `invalid-refresh`; the refresh
route does not consult the distinction.

**Failure scenario.** A transient GoTrue 5xx or a network blip signs out **every active user
simultaneously**, and they cannot sign back in while it persists. A brief dependency hiccup
becomes a full-population logout — the worst possible amplification of a partial failure.

**Remediation.** On `unavailable`, keep the cookies and fail the navigation with a retry
surface; clear only on `invalid-refresh`. Note this interacts with the loop guard: retaining
cookies retains the redirect trigger, so a bounded retry or a short-lived marker is required to
avoid reintroducing the loop the current design so carefully eliminated. **Design this change
against the structural guard, not around it.**

**Regression risk: Medium** — this is the one part of the refresh design where a careless
change reintroduces a redirect loop. Treat the existing loop-guard property as the invariant
to preserve.

**Tests to add.** Provider 500 → cookies retained, no loop. Provider 400 → both cleared, next
pass reaches sign-in.

## P1-4 · No application-level rate limiting

**Evidence.** Provider 429s are *handled* and mapped; AutoBureau enforces **none of its own**.
`/v1` has no rate limiting at all. No Redis client exists to back one.

**Failure scenario.** Credential stuffing against `/v1/auth/sign-in` is bounded only by
GoTrue's own limits, which are unverified (no project exists) and shared across the deployment.
`/v1/auth/magic-link` can be driven to send mail to arbitrary addresses — the endpoint is
correctly enumeration-safe (always 204), but that also means abuse is invisible, and with P0-4
it is unlogged. Combined with P1-2, an attacker can hold open many slow requests.

**Remediation.** Per-IP and per-account limiting on auth endpoints first, then `/v1` generally.

**Regression risk: Low**, but requires infrastructure (Redis) that does not yet exist.

**Tests to add.** N+1 attempts → 429; limit is per-account not global.

## P1-5 · `users` and `user_profiles` have no RLS; enforcement is application-only

**Evidence — verified empirically.** `relrowsecurity = false` on both. As `app_user`, at any
household scope, both tables return **all rows**:

```
scoped to House A → households visible: 1 (correct)
                  → users visible:      2 (all rows, global table)
```

This is deliberate and documented (the RLS migration states these are not household-scoped and
enforcement lives in the session layer), and the one live query does scope correctly with an
explicit `where: { id: ctx.userId }`.

**Failure scenario.** The database provides **no backstop** for the global identity table. Any
future query against `users` that omits its `where` — a member-picker, an admin view, an
invitation lookup, a `findMany` written in a hurry — exposes every user's email address across
all tenants, and no RLS policy will stop it. The blast radius is the entire user base.

**Remediation.** Either (a) add a `request.user_id`-keyed self-read policy, mirroring the
`self_membership_read` pattern that already exists and works, or (b) accept it explicitly and
add a CI fence plus an integration test asserting that no unscoped read of `users` is
reachable. The self-read policy pattern in the principal-scope migration shows this is
achievable without breaking phase-1 resolution.

**Regression risk: Medium** if adding a policy — identity mirroring writes with no household in
scope and must keep working; the `withIdentity` path is the one to verify.

**Tests to add.** Cross-principal read attempt on `users` under household scope → zero rows.

## P1-6 · Idempotency is advertised and unenforced

**Evidence.** `api-client.ts:74` generates an `Idempotency-Key` for every unsafe non-DELETE
request. **No server code reads the header** — verified by exhaustive search. The client's own
comment claims "a double-tapped button on a flaky train connection cannot create two
obligations."

**Failure scenario.** With domain endpoints in place, a retry on a flaky mobile connection —
the product's stated usage context, "a phone in a waiting room" — creates duplicate
obligations, duplicate members, or duplicate document records. Compounded by
`ObligationCard`'s complete button and `ConfirmDialog`'s callers not passing `loading`, so
double-clicks fire N mutations. On a destructive confirm this is the dangerous shape.

**Remediation.** Honour `Idempotency-Key` server-side before the first write endpoint ships:
store key + request hash + response, replay within a TTL. The canonical-hashing primitive in
`packages/contracts` already exists for exactly this.

**Regression risk: Low** now; **High** if deferred until after endpoints exist.

**Tests to add.** Same key twice → one row, identical response. Same key, different body →
conflict.

## P1-7 · The only external integration has zero tests

**Evidence.** `provider.ts` has no test file. Its own header states *"PROVIDER COMPATIBILITY IS
UNVERIFIED… Whether the real provider agrees is the first thing to check once a project
exists."*

**Failure scenario.** Every authentication path depends on this module's request shapes, its
status mapping, and its guarantee never to leak a provider body. A mapping error turns
`invalid-credentials` into `unavailable` (or worse, leaks an enumeration oracle) and no test
would catch it.

**Remediation.** Contract tests against a recorded GoTrue fixture, and a live smoke test once a
project exists.

**Regression risk: None** — adding tests.

**Tests to add.** Status→reason mapping for 400/401/403/429/5xx; assertion that no provider
body reaches a response or a log; `should_create_user` behaviour on `/otp` (see P2-4).

## P1-8 · Multi-household users are denied access entirely

**Evidence.** `context.ts:159` — more than one membership without `X-Household-Id` → **400
`ambiguous-household`**. `apiFetch` supports a `householdId` option that **no caller passes**.

**Failure scenario.** This is an availability failure, not a confidentiality one — and the
server's refusal to guess is the *correct* security posture. But the caregiver persona the
product targets is exactly the person holding their own household and a parent's, and they are
locked out of every authenticated page.

**Remediation.** Persist an active household and pass it through `apiFetch`. Belongs to the
identity audit; do not patch it here.

**Regression risk: Medium–High** — touches the universal chokepoint.

**Tests to add.** Two memberships + valid header → scoped correctly. Two memberships + header
for a **third** household → 403, indistinguishable from "no such household".

---

# P2 — Hardening opportunities

| # | Finding | Evidence | Remediation | Risk |
|---|---|---|---|---|
| **P2-1** | No request body size cap | `request.json()` parses before Zod validates; schemas cap fields (`email` 320, `password` 1024) but not the body | Cap body size at the edge | Low |
| **P2-2** | Two independent JWKS caches, no local fallback | Middleware (Edge) and route handlers (Node) each build their own `createRemoteJWKSet` with jose defaults | Consider a pinned local JWKS fallback; monitor fetch latency | Low |
| **P2-3** | No server-side session revocation list | Revocation depends entirely on the provider; nothing local can invalidate a token before `exp` | Consider a denylist keyed on `sub`+`iat` for incident response | Medium |
| **P2-4** | `/otp` may create users implicitly | `requestMagicLink` does not send `should_create_user: false`; GoTrue defaults to `true` | Decide explicitly whether magic link may create accounts | Low |
| **P2-5** | CI does not fence bare `PrismaClient` | Guardrails fence provider SDKs and the dispatcher escape hatch, not the invariant most exposed to ordinary feature work | One `grep` step | None |
| **P2-6** | `users.email` never updated after mirroring | Mirror only creates; a provider-side email change leaves the local copy stale | Refresh on sign-in, or treat the token as authoritative at read time | Low |
| **P2-7** | Unindexed FKs enable lock-under-scan on delete | 7 FKs without covering indexes (architecture review W8) | Add indexes before the deletion cascade ships | Low |
| **P2-8** | No E2E security regression tier | 459 tests, none crossing browser↔server | Thin Playwright suite; Chromium is already available | Low |

---

# What is genuinely strong

Stated plainly, because a security audit that only lists problems misrepresents this codebase.

1. **Tenant isolation is enforced by the database and empirically verified.** Unscoped reads
   return zero rows; scoped reads return exactly one household. `app_user` is provably
   non-superuser, non-owner, `NOBYPASSRLS`. The GUC is bound as a **parameter**, closing a SQL
   injection sink at the exact point a request-derived value meets SQL.
2. **PKCE is textbook.** S256 only, 32-byte verifier, cookie path-scoped to `/auth/callback`,
   cleared on **every** redemption attempt including failures, and the post-login destination
   carried in the cookie rather than `redirect_to` — so an attacker cannot choose where a
   victim lands.
3. **Enumeration oracles are closed deliberately and consistently.** Magic link always returns
   204. Sign-in collapses wrong-password and unknown-account. `not-a-member` is
   indistinguishable from "no such household". Provider response bodies are never surfaced or
   logged.
4. **Audit attribution cannot be forged by application code** — `actor_id` defaults to
   `app.current_user_id()` and a `CHECK` constraint rejects `user` rows without one.
5. **The phase-1/phase-2 policy split is subtle and correct**, including the
   `app.current_household() IS NULL` guard that stops permissive policies OR-ing together. The
   migration records that they measured the wrong behaviour (3 rows where 2 were correct)
   before fixing it.
6. **No token in browser storage.** Verified: `localStorage` holds only a theme preference.
7. **`no-store` on every `/v1` response**, success and error alike — because every body is
   household data.
8. **Migration lock discipline** — `NOT VALID` + `VALIDATE` to avoid holding ACCESS EXCLUSIVE.
9. **Fails closed when unconfigured** — verified live: 401 and 503, never open.

---

# Security Hardening Gate

**Minimum conditions before any external user testing.** These are gating, not aspirational.
Ordered so that each is verifiable.

### Gate A — Nothing may lie about security (blocking)

- [ ] **A1** Sign-out terminates the session: posts to `/v1/auth/sign-out`, clears cookies,
      revokes at the provider. Verified by E2E. *(P0-1)*
- [ ] **A2** The MFA toggle is removed or disabled. No control claims a protection that does
      not exist. *(P0-3)*
- [ ] **A3** All five encryption claims moved to commitment tense, **or** ADR-007 implemented.
      *(P0-5)*
- [ ] **A4** Deletion and export either work or stop claiming to. *(P0-6)*
- [ ] **A5** No remaining UI surface asserts a completed security or privacy action that did
      not occur.

### Gate B — Incidents must be detectable (blocking)

- [ ] **B1** Production logging enabled with redaction; no token, cookie, or provider body ever
      logged. *(P0-4)*
- [ ] **B2** Error reporting wired, with correlation IDs.
- [ ] **B3** Security events emitted: auth failure, CSRF rejection, `not-a-member`,
      `no-membership`, 403.
- [ ] **B4** The P1-1 collision path produces a distinct, logged, non-500 outcome.

### Gate C — Boundary hardening (blocking)

- [ ] **C1** CSP nonce implemented and `'unsafe-inline'` removed from `script-src`; **or** the
      comment corrected and the residual risk explicitly accepted in writing by the owner.
      *(P0-2)*
- [ ] **C2** Rate limiting on all auth endpoints. *(P1-4)*
- [ ] **C3** Timeouts on every outbound provider call. *(P1-2)*
- [ ] **C4** Refresh distinguishes provider outage from revoked token **without** weakening the
      structural loop guard. *(P1-3)*
- [ ] **C5** `users` RLS decision made explicitly: policy added, or accepted with a CI fence and
      a test. *(P1-5)*

### Gate D — Before the first write endpoint ships

- [ ] **D1** Server-side idempotency honoured. *(P1-6)*
- [ ] **D2** `provider.ts` covered by contract tests and verified against a real project.
      *(P1-7)*
- [ ] **D3** Tenant-isolation integration suite passes on every merge (already enforced in CI —
      keep it).
- [ ] **D4** E2E suite covering: sign-in, sign-out actually signs out, protected-route redirect,
      session expiry and refresh, cross-tenant `X-Household-Id` rejection.

### Gate E — Explicitly NOT gating

Recorded so effort is not misdirected: multi-household support (P1-8, availability not
confidentiality), unindexed FKs (P2-7), JWKS tuning (P2-2), body size cap (P2-1), and the
session revocation list (P2-3). Each is real; none should delay external testing.

---

**Gate summary.** Gates A and C1 are the difference between "incomplete" and "misleading about
security" — and this product's entire proposition is being the trustworthy one. Gate B is what
makes every subsequent finding discoverable rather than theoretical. None of Gate A requires a
backend; most of it is deletion of false claims.
