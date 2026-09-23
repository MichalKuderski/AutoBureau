# Staging validation — executed evidence for the auth/identity slice

Validation pass over `2ebe11b` (`feat(auth): implement real sign-up and route the
household-less user`). Everything below was **executed**, not inspected. Where a check could
not be executed, it says so and says why — an unrun check is recorded as unrun.

## 1. Source truth (corrects the record)

The commit `2ebe11b` was pushed to `claude/autobureau-hardening-audit-1tb0gh`, **not** to
`main` and not to a branch named for the sign-up work. Two claims in circulation were wrong:

| Claim | Actual |
|---|---|
| "`main` is eight commits behind" | `main` is **55 commits** behind that branch |
| "no migration/schema changes were needed" | True of the sign-up route itself; the branch as a whole carries **two** migrations `main` has never had |

`main` is at `56cf76e`. The two migrations are `20260823000000_idempotency_keys` and
`20260825000000_auth_rate_limits`.

## 2. Staging database repair

Staging had applied four of six migrations. The two above were missing, and the code on the
branch requires both.

The consequence was not a crash. `enforceRateLimit` is deliberately **fail-open**
(`rate-limit.ts`, "limiter degradation is not database failure"), so a missing
`auth_rate_limits` table means the documented limits silently do not exist while the endpoint
keeps answering. Observed directly in the server log as
`auth.rate_limit_degraded` / `auth.rate_limit_unavailable` before the repair.

Both migrations were applied to staging unchanged, and `_prisma_migrations` was updated with
each file's real SHA-256 so Prisma's ledger stays consistent. Rollback is the one each
migration already documents (`DROP TABLE`). After the repair, staging reports all six
migrations, and both tables have RLS **enabled and forced** with the `app_user` grants.

## 3. What was executed

Postgres 16 + pgvector, local; `app_user` non-superuser, non-`BYPASSRLS`, so every assertion
below ran under RLS.

| Gate | Result |
|---|---|
| `pnpm typecheck` | 6/6 packages clean |
| `pnpm lint` | clean |
| `pnpm test` | **921** passing (web 819 · contracts 78 · db 16 · ops 8) |
| `pnpm test:integration` | **314** passing (web 266 · db 48) |
| `pnpm build` | production build clean, 11/11 static pages |
| client bundle scan | zero secrets, zero JWT-shaped strings |

The unit and integration suites both fail closed without a generated Prisma client; the
client must be generated before either is meaningful.

### End-to-end, over HTTP, against the real production server

`next start` on the production build, driven with real requests. The provider hop
(GoTrue + JWKS) was served by a local ES256 stand-in because this environment's egress proxy
denies `*.supabase.co`; **every AutoBureau code path — JWT verification, mirroring, household
bootstrap, cookies, middleware, routing — is the shipped one.**

- Sign-up with confirmation **disabled** → `204` + both cookies, each `HttpOnly; Secure; SameSite=Lax`.
- Sign-up with confirmation **required** → `202 confirmation-required`, and **no session cookies before verification**.
- Already-registered address is not distinguishable from a fresh one.
- CSRF: cross-origin `POST` → `403`; same-origin `POST` without `x-autobureau-request` → `403`.
- Rate limiting enforces the documented policy: attempts 1–3 answered, **4th and 5th → `429`**.
- Refresh (`GET /auth/refresh`) → `303`, **rotates both tokens**; a replayed refresh token lands on sign-in.
- Sign-out clears both cookies (`Max-Age=0`); the protected endpoint then `401`s; re-login works.
- Forged / `alg`-confusion token → `401`.
- Hostile `?next=` on both sign-in and refresh is not honoured.
- `Host` header does **not** influence redirect `Location` — no host-header injection.
- No raw JWT appears in server logs.

### The two reported defects, retested

- `/v1/households/current` returns `200` with a real household (`role: owner`). The 403 is gone.
- `/dashboard` returns **200** for a provisioned user, and **`307 → /onboarding`** for a
  household-less one — for `/obligations` and `/settings/privacy` too. The 500 is gone.
  The `/v1` boundary stays strict and still answers `403` rather than redirecting.

### Tenant isolation

Two signups get two distinct households. Selecting another tenant's household via
`X-Household-Id` → `403`, indistinguishable from a nonexistent one, leaking nothing. A
malformed id → `400`, not a 500. The identity chain lands exactly 1:1:1:1:1 —
user → profile → household → owner membership → `free` entitlement.

## 4. Not verified here, and why

- **Live staging HTTP and the EC2 host.** The egress proxy denies `*.supabase.co` and every
  non-allowlisted host; there is no AWS CLI, no SSH key, and no credential for the staging
  Postgres. The deployed EC2 process could not be inspected, and no request was made against
  the live staging URL. Database state was reachable only through the Supabase MCP.
- **Vercel project configuration.** No Vercel token in this environment; the deploy workflow
  takes env from `vercel pull`, so the effective `APP_ORIGIN`, `AUTH_*` and `DATABASE_URL`
  per environment were not read and remain unconfirmed.

## 5. Findings

| # | Sev | Finding |
|---|---|---|
| 1 | **BLOCKER (production only)** | The **AutoBureau Production** Supabase project is **empty** — 0 public tables, no `_prisma_migrations`, no `app_user` role, 0 auth users. Production has never been provisioned. |
| 2 | **HIGH** | Onboarding persists **nothing**. `onboarding-provider.tsx` is in-memory React state; no step writes to the server, so census answers do not survive a refresh, onboarding is bypassable, and no "completed" state exists. This is tracked work, not a regression — P1-02 lists "onboarding persistence", and PRD F3 requires provisional items and resumability. It is wedge-dependent and gated on G1. |
| 3 | **MEDIUM** | `APP_ORIGIN` has no `VERCEL_URL` derivation in code. `.env.example` §94 prescribes it for previews, but nothing implements it, so any preview whose `APP_ORIGIN` names production will `403` its own form posts on the CSRF origin check. Correct fix is per-environment config (`APP_ORIGIN=https://$VERCEL_URL` for Preview only), not a code change — production must keep its literal custom domain. |
| 4 | **MEDIUM** | Session cookies are unconditionally `Secure`. Correct for production; it also means any staging or local deployment served over plain HTTP cannot hold a session in a real browser — sign-in appears to succeed and the user bounces back. |
| 5 | **LOW** | Supabase advisor flags a mutable `search_path` on `app.current_household()` / `app.current_user_id()`. **Not exploitable as configured**: both are `SECURITY INVOKER`, and `app_user` holds no `CREATE` on `public`, `app`, or the database, so it cannot plant a shadowing function. Worth pinning `SET search_path` as defence in depth. |
| 6 | **LOW** | Supabase leaked-password protection (HaveIBeenPwned) is disabled on staging. The app does its own `assessPassword`; enabling this is defence in depth. |
| 7 | **LOW** | `vector` is installed in `public` (advisor `extension_in_public`), which is what the repo's own init migration does. |

Nothing above required a source change. The code on `2ebe11b` is sound as written; the gaps
are environmental and configuration-level.
