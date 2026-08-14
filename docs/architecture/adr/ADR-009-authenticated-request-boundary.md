# ADR-009: The authenticated request boundary (session transport, household resolution, route protection, CSRF)

**Status:** Accepted (2026-08-14) · **Date:** 2026-08-14
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

## Consequences

- ✅ The four gaps that would have been filled by convention are now filled by decision, each with
  an acceptance test attached (doc 11 §3 style: the invariant, not the implementation).
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
