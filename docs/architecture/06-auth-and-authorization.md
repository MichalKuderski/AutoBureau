# 06 — Authentication & Authorization

## 1. Authentication (Supabase Auth)

- **Methods at launch:** email+password (with mandatory verification), magic link, Google OAuth, Apple OAuth (required for future iOS). Passkeys fast-follow — the audience skews non-technical; "no password" is a retention feature.
- **MFA:** TOTP available to all; enforced (grace-period prompt) once a household contains >1 user or any `item_secrets` row — the data justifies the friction exactly then.
- **Sessions:** Supabase JWT (access 1 h) + rotating refresh token in `HttpOnly; Secure; SameSite=Lax` cookies. No tokens in localStorage, ever.
- **Password policy:** zxcvbn score ≥3 + haveibeenpwned k-anonymity check at set time. No composition rules, no forced rotation (NIST 800-63B).
- **Account recovery:** email-based only in v1. Support staff **cannot** reset MFA without a documented identity-verification runbook (social-engineering surface — doc 12 §8).
- **Abuse controls:** signup/login rate limits per IP + per identifier; Cloudflare Turnstile on public auth forms (invisible-first).

## 2. Session → request context

Every `/v1` request resolves `RequestContext {user_id, household_id, role}`:
1. Verify Supabase JWT (JWKS, cached).
2. Read `X-Household-Id`; verify membership in `household_users` (cached in Redis 60 s, invalidated on membership writes).
3. Attach role. Handlers never re-derive identity; they receive context or the request already 401/403'd in middleware.

## 3. Roles

| Capability | owner | member | viewer |
|---|---|---|---|
| Read registry/documents/obligations | ✅ | ✅ | ✅ |
| Upload documents, review queue | ✅ | ✅ | ❌ |
| Create/edit items & obligations | ✅ | ✅ | ❌ |
| Start task runs | ✅ | ✅ | ❌ |
| **Approve external actions** | ✅ | ✅* | ❌ |
| Manage members/invites/roles | ✅ | ❌ | ❌ |
| Manage email alias, notification defaults | ✅ | ❌ | ❌ |
| Read `item_secrets` (reveal full value) | ✅ | ✅ | ❌ |
| Delete household / export data | ✅ | ❌ | ❌ |

\* Owners can restrict approvals to owner-only per household (settings toggle). Viewer exists for the "let my accountant look" case.

Enforcement is centralized: a `can(ctx, action, resource)` policy module in `modules/platform` — handlers call it; policy logic never lives inline in handlers. (CASL-style; the library choice is an implementation detail, the centralization is not.)

## 4. Household scoping

Every Prisma query goes through a scoped client: `db.forHousehold(ctx)` returns a client extension that injects `household_id = ctx.household_id` into every where-clause for household-scoped models and refuses queries on those models without it. Forgetting a scope is a type error, not a code-review hope.

## 5. RLS: the second wall

RLS is **enabled on every household-scoped table** even though the app connects via Prisma. Pattern:

- App role `app_user` connects through the transaction-mode pooler; **every scoped unit of work runs inside an explicit Prisma `$transaction` whose first statement is `SET LOCAL request.household_id = ...`** (review A1/F-01 — `SET LOCAL` is transaction-scoped: outside a transaction it silently never applies, and a session-level `SET` would leak tenant context across pooled connections). Policies check `household_id = current_setting('request.household_id', true)::uuid`. Serverless safety rules: transactions are short by construction (no network I/O — model calls, storage, webhooks — inside a transaction), pool-wait p95 is a paged metric, and the pre-agreed escape hatch is relocating `/v1` onto a long-lived Node service beside the AI service — the API is portable by construction (ADR-008), so that is a redeploy, not a rewrite.
- `audit_log`: INSERT-only for all app roles (no UPDATE/DELETE grants at all).
- `service_role` usage is confined to migrations and two named jobs (deletion cascade, dispatcher); a CI grep forbids it elsewhere.

Why keep RLS if the app layer already scopes? Defense-in-depth against the class of bug we *will* eventually write (a raw SQL report query, a forgotten scope in a new module), and it keeps the option of Supabase client-side reads for some future surface without a security rewrite. Cost: the `SET LOCAL` plumbing + policies in SQL migrations (ADR-002).

## 6. Service-to-service auth

- `apps/web` → AI service: short-lived (5 min) HS256→RS256 service JWT, `aud: ai-internal`, carrying `{household_id, user_id, purpose}` claims; AI service verifies and scopes all its own DB reads by the claim, never by request body. Key in Doppler, rotated quarterly, dual-key rollover.
- Browser → AI edge (chat SSE only, review A2): posting a message to `/v1` mints a **single-use stream token** (60 s, `aud: ai-stream`, scoped to one conversation); the AI edge verifies it and streams the response directly to the client. Tokens are dead after use — reconnects go back through `/v1`.
- Workers → DB/AI: same JWT minting from worker identity; ECS task role provides AWS-side permissions (KMS, S3 backups) — no static AWS keys anywhere.
- Webhooks inbound: HMAC signature + timestamp (±5 min replay window) + source IP allowlist where the sender supports it.

## 7. Future-proofing notes

- All authz decisions flow through `can()` → adding audit of *denials*, anomaly alerts, or a policy-as-code engine later is one module's change.
- If B2B ever happens, `households` does **not** become `orgs`; a separate org model composes household-like spaces (doc 00 §5). Recording this now so nobody "just renames the table" in month 9.
