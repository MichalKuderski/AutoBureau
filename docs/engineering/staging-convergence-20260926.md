# Staging/provider convergence — September 25–26, 2026

**Decision: NO-GO.** The exact runtime candidate is on stable staging, with the full migration
chain applied and verified. But the hosted build does not mount MFA, recovery, export,
Stripe TEST or Plaid Sandbox paths, so those gates cannot pass at this candidate. The Supabase
incident is open with the provider, and no external approval exists.

Everything below was done under the operator's staging/test-only authorization of September 25.
Nothing touched Production, Stripe Live, Plaid Production, DNS or `main`.

## Provenance

| Item | Value |
| --- | --- |
| Runtime candidate | `88829364ca5bda38630573b47cd5432b43acfa2e` (tree `a79769ae`), GitHub branch **`preprod/pellum-8882936`** (HEAD is exactly this commit) |
| Documentation successor | `c8886a6c5fe1…` on **`preprod/pellum-8882936-evidence`**; this report is a further docs-only commit on that branch |
| History | 36 local commits rooted at the snapshot of upstream `57d0790` (tree `a5bac62c`); pushed as new branches with unrelated history, no force, `main` unchanged (`3695e6c`) |
| Pre-push controls | worktree clean; ancestry `8882936` → `c8886a6` (docs only); only `.env.example` ever tracked among sensitive path patterns; gitleaks 8.30.1 (checksum-verified official release) over all 36 commits: 23 findings, all in the baseline snapshot, all triaged false positives (migration checksums keyed by `…_keys`/`…_limits` names; fabricated test fixtures); supplementary pattern scan of 993 blobs: synthetic fixtures only. Author metadata matches upstream `main` |
| Workflows on branch push | none (CI and Deploy run on `main` pushes, PRs, or dispatch). **GitHub CI never ran on the pushed branch**; the candidate's CI-equivalent evidence is the local exact-candidate suite |

## Protected staging accounts (metadata only)

- The one application user whose address is non-synthetic **matches an operator address**
  (SHA-256 comparison inside the database; only a boolean left it). It has 1 household, 0 MFA
  factors, a single sign-in on September 9, and was not read, changed or signed into.
- A wider check found **two more non-synthetic addresses that exist only in Supabase Auth**
  (no application row, created mid-August, public-mailbox domain, not matching either known
  operator address). They are **protected unknown data**. The delta touches no `auth` schema
  object and no existing user row. After the migration both are unchanged (same creation,
  sign-in and factor metadata). **Operator: identify them.**

## Staging migration 13 → 45 (item 3)

Every precondition was checked immediately before execution:

| Pre-check | Result |
| --- | --- |
| Target | `kdqnfruwgocfqwpbpuxo` ("AutoBureau", us-west-2, PG 17.6); Production project not targeted. The workflow's `verify-staging-migration-target.mjs` printed "Approved staging migration target verified." |
| Applied | exactly 1–13, all finished, none rolled back; checksums equal to the SHA-256 of the first 13 source files |
| Pending | exactly the reviewed 32 (`20260920000000_document_security_journals` … `20261002000001_household_anchor_minimization`) |
| Repository preflight (`upgrade-preflight.sql`, run in the editor and again by the workflow) | `ok: true`, 0 documents, 0 nonzero legacy quota usage (cutover precondition), 0 TEST billing journals, no delta role pre-exists |
| Destructive statements | none against existing rows (no DROP TABLE/COLUMN, TRUNCATE, UPDATE, DELETE). Drops are limited to constraints, policies and triggers created inside the delta. Pre-existing tables gain 4 tenant-parity FKs (0 mismatches), FORCE RLS on `users`, and nothing else |
| Unbounded locks | 3 migrations lack `lock_timeout` (`20260921000000`–`0002`). Applied in a confirmed-idle window: at 03:35Z and again at 13:17Z, 0 application sessions, 0 active client queries, 0 locks on `public` relations |
| Pre-apply receipt | hosted-safe posture snapshot saved (sha256 `1542f72e…`), plus the reviewed plan with rollback strategy |
| Rollback | per-migration transactions; forward-fix only. **The project is on the Free plan and shows "No backups", so restore is not a rollback path.** The delta is additive, which is why forward-fix was acceptable for synthetic staging |

Execution: GitHub `staging` environment protection allows only `main`. Run #92 was refused before any
step. With the operator's decision, an exact-name deployment-branch rule `preprod/pellum-8882936`
was added, **run #93** (`stage=migrate`) checked out `88829364…`, verified the target, printed the
preflight verdict and applied all 32 migrations (13:21:37–13:21:50Z, "All migrations have been
successfully applied."). After the deploy stage the rule was removed; the environment is `main`-only
again. Historical migrations were not edited.

### Post-migration verification

| Check | Result |
| --- | --- |
| Ledger | 45 rows, all finished, 0 rolled back; checksums identical to the local rehearsal |
| Posture vs local Supabase-shaped PG17 rehearsal (same query) | **identical**: 57 tables with RLS/forced-RLS/owner, 72 policies, 636 column grants, 112 triggers, 2 views, all 46 application functions (bodies, config, owner, EXECUTE), 0 unvalidated constraints, 0 schema CREATE for runtime/API roles |
| Differences, all platform-owned | pgvector functions owned by `supabase_admin` (vs `postgres` locally); Supabase role attributes/memberships; `app_user` LOGIN (runbook D-4, pre-existing); 18 API-role sequence grants exist only in the local emulation (hosted has **0 API-role table/sequence grants**, stricter) |
| SECURITY DEFINER | 0 |
| Security Advisor (rerun after the change) | 0 errors, 0 info, the same 5 warnings as the September 25 baseline (`app.current_*` search_path, `vector` in public, `auth_rate_limits` always-true policy, leaked-password protection). The 32 migrations added none; nothing was suppressed |
| Data API | `public` and `graphql_public` exposed, `app` not; **0 of 59 tables and 0 of 139 functions exposed**; automatic exposure of new tables off |
| Existing rows | exact counts before and after: 173 users, 173 households (other pre-apply figures were planner estimates only). After: 173 entitlements/profiles/`household_users`, 7 rate-limit rows, 181 auth users; all 865 audit rows predate September 14 (the 755 in the September 25 readback was an estimate). No content digest of existing rows was taken before the apply, so "unchanged" rests on those counts, protected-row metadata, audit timing and the delta review |

### Migration-ledger privilege, hosted (item 9)

One DO block ran as `postgres`. It always ends in RAISE, so nothing it did committed. It granted
itself SET on each runtime role, and as each of the 8 `app_*` roles (billing-test, deletion-verifier,
dispatcher, document-worker, job-worker, plaid-sandbox, retention-worker, user) it attempted SELECT, INSERT of a
forged future migration `20991231000000_forged_future`, UPDATE (`rolled_back_at` on the ledger-revoke
migration), DELETE and TRUNCATE on `_prisma_migrations`:

- **All 40 attempts: `denied`.**
- Controls: the owner's insert was `ALLOWED`. `app_user` with a temporary INSERT grant was `ALLOWED`,
  so the probe can see a permitted write.
- Catalog: no privilege for any `app_*`, `anon`, `authenticated`, `service_role` or `authenticator`.
- Afterwards: 45 ledger rows, 0 forged, 0 SET memberships left, `app_user` INSERT false.

The same statement produced the identical result on the local rehearsal first.

## Exact-candidate staging deployment (item 4)

**Run #94** (`stage=deploy`) checked out `88829364…`.
- Build: Vercel CLI 60.1.3, Next.js 15.5.22, pnpm 10.34.5.
- Deployment: `91pxb35Ma…` / `autobureau-staging-4wjyvdeiu…`, aliased to **`autobureau-staging.vercel.app`**.
- The Vercel dashboard shows it Ready and Current in the staging project's Production scope, source
  `preprod/pellum-8882936` @ `8882936`.
- Smoke against the stable origin: **17/17**.
- Staging acceptance: **57/57**, covering sign-up and cookie flags, household bootstrap, cross-tenant
  and nonexistent-household 403 without leakage, CSRF, refresh rotation and safe replay, hostile
  redirects refused, sign-out revocation, and the sign-up limit with no account-existence oracle.

It wrote synthetic `acc-*@example.com` identities only.

### Hosted capability at the candidate (from the deployed code and hosted observation)

| Capability | Hosted state | Evidence / gap |
| --- | --- | --- |
| Exact SHA, build, environment, migration level | **PASS** | runs #93/#94, Vercel deployment page, ledger 45/45 |
| Route health, headers, CSP, anonymous protection | **PASS** | smoke 17/17; 9 protected routes redirect to sign-in in 3 engines |
| Sign-up, sign-in, refresh, sign-out, tenant isolation, CSRF | **PASS (API level)** | acceptance 57/57 |
| MFA enrollment/verification, last-factor protection | **NOT MOUNTED** | `/v1/account/security` is local-mount only ("No flag can turn this into a hosted/provider path") |
| Password recovery | **NOT MOUNTED** | `/v1/auth/recovery*` local-mount only; `/forgot-password` says "Not available in this preview … No reset email has been sent" |
| Household/member management | code path hosted; **not exercised in a browser here** (operator harness below) | |
| Documents, quotas, scanner/custody, review/publication | **NOT VERIFIED hosted**; intake is configuration-gated (`DOCUMENT_INTAKE_ENABLED` exists in the staging project; value not read); scanner is local (ADR-018) | |
| Export | **UNAVAILABLE by design**: `exportArchiveStorage()` returns null on any Vercel runtime (no hosted object storage or KMS-custodied export key) | |
| Deletion request/undo | code path hosted (DB-backed); not exercised in a browser here | |
| Reminders | delivery pipeline absent (UI says so) | |
| Billing (Stripe TEST) | **NOT MOUNTED**: display-only status route; no checkout, portal or webhook route exists | |
| Plaid Sandbox | **NOT MOUNTED**: `linkAvailable: false`; no link-token, exchange or webhook route | |
| Observability | not established hosted: the Vercel runtime-log view showed no rows for the deployment filter (inconclusive); SNS alert delivery was never proven (`notificationDeliveryProven: false`) | |

## Stripe TEST (item 5) and Plaid Sandbox (item 6)

Neither provider lifecycle can be run through the application at this candidate. The deployed
build has no Stripe checkout/portal/webhook endpoint and no Plaid link/exchange/webhook endpoint.
The billing and Plaid code exercised so far runs locally against deterministic, provider-shaped
adapters. Both dashboards were at their sign-in pages.

To run these gates, the product needs:
- hosted endpoints (Stripe checkout and portal creation, a signature-verified webhook inbox, a
  provider-refetch reconciler; Plaid link-token, exchange, webhook verification and sync workers);
- a hosted placement for the Plaid runtime that keeps it away from document, model, billing and
  MFA secrets;
- TEST/Sandbox credentials placed in the staging configuration **by the operator** (I cannot enter keys);
- signed-in dashboard sessions.

The dedicated billing authority was not touched. **Status: IMPLEMENTATION GAP + BLOCKED.**

**KMS:** ADR-022 requires a separate operational review for KEK custody. The only KMS key in the
staging AWS infrastructure encrypts the operational-alerts topic. No key-management provider is
approved for Plaid custody. The fake-port seam is **not** operational evidence. Decision required
(below); no KMS was provisioned.

## Supabase incident (item 7)

The sanitized packet was reviewed again and **sent** on 2026-09-26 at about 13:44Z through the dashboard
support form (category APIs and client libraries, severity Low, service Authentication). The form's
"Allow support access to your project" switch was **on by default and was turned off**, because
staging holds three non-synthetic accounts. The message contains only the project ref, opaque
request/log IDs, UTC timestamps, routes and timings. It asks for correlation across the Auth service,
database, network, proxy/gateway, dependency saturation and other telemetry, for origin_time units,
and whether the management/OAuth tokens exposed on September 13 around 20:03 UTC were invalidated
and used afterwards. The dashboard confirmed "Your ticket has been logged" but **shows no ticket
number**; it arrives by email to the account address. **Operator: record it.** No retries, timeout
changes or credential mutations. Disposition: **OPEN — PROVIDER INVESTIGATION PENDING.**

## Staging Auth configuration (item 8)

Reviewed against the code. **No setting was changed.**

- **Finding (P1 for launch): hosted sign-up does not apply the binding password policy.**
  - `createPasswordPolicy` (length 8–128, zxcvbn ≥ 3, HIBP k-anonymity) is wired only into the
    local-mount recovery path; its own comment says "No route activates it yet".
  - `POST /v1/auth/sign-up` applies only `assessPassword`, which its file describes as "a hint, not
    the gate": length ≥ 8, a 21-word deny-list and a heuristic score.
  - Supabase's own minimum is 6, and leaked-password protection is off (a Pro-plan feature).
  - Together, a breached passphrase of 8+ characters can be set on hosted. There is **no**
    stronger server-side HIBP enforcement to rely on as defense in depth today.
- Change plan, not applied:
  1. Code: enforce `createPasswordPolicy` on every hosted password-setting route, refusing when
     the check is unavailable, as the recovery path does. Tests would need a network-free breach fixture.
  2. Supabase staging: raise the minimum length 6 → 8, matching the application floor.
     - It affects only newly set passwords; existing sessions and passwords are untouched.
     - Verify with the deploy workflow's acceptance run.
     - I can't create accounts on a hosted service myself.
  3. Production items: confirm email on (staging stays off; `staging-acceptance.mjs` requires it off);
     secure password change on; leaked-password protection (Pro plan: a billing decision); a CAPTCHA
     decision; a redirect allow-list without `localhost`.

## Hosted browser matrix (item 10)

- **Anonymous pages, run: 95/95 in Chrome 153, WebKit 26.6 and Firefox 155** against
  `autobureau-staging.vercel.app`.
  - Covered: `/`, `/sign-in`, `/sign-up`, `/forgot-password` in light and dark with reduced motion.
    Checks: title and lang, h1, main landmark, accessible names, AA text contrast, image alt, keyboard
    reach with a visible focus indicator for every form control, reflow at 390 px, 320 px and
    200%-equivalent, and 9 protected routes landing on sign-in.
  - Nothing was submitted.
  - A first run expected a recovery form on `/forgot-password` and is retained separately (2 expected-form failures per engine).
- **Authenticated hosted flows were not run by me.** They require creating accounts and entering
  passwords on a hosted service, which I don't do outside local development hosts.
  - The operator-run harness `hosted-auth.mjs` (sha256 in the evidence) covers keyboard sign-up,
    onboarding, the authenticated page sweep and household deletion with undo, all with synthetic
    accounts and a random password it never prints.
  - It records MFA, recovery and last-factor protection as **not mounted** after checking that the
    hosted page is honest about it.
  - Stripe TEST and Plaid flows cannot be covered (not mounted).
  - Screen reader: not run.

## Operational readiness (item 11)

| Area | State |
| --- | --- |
| Logging/observability | Structured JSON logs; the Sentry sink is configuration-gated (ADR-014/015; DSN presence not read). Hosted runtime-log review was inconclusive |
| Alerts | an SNS/CloudWatch alerts template and a fail-closed subscription parser exist; live deployment state was not re-read here and **delivery to a human was never proven** |
| Provider failures | Auth 504 path returns a neutral 503 with no retry (by design); provider incident open |
| Cost controls | staging cost plan exists; no hard spending cap; free-plan resources |
| Backup/restore | **Staging (Free plan) has no backups**; a restore drill is impossible there; production PITR/backup tier is a founder/billing decision |
| Incident response / on-call | cutover runbook requires "a named person can decide on rollback and is reachable" (A-3); no on-call owner is recorded |
| Rollback | Vercel instant rollback (pointer move) for application; schema forward-fix only |
| Runbook currency | `docs/hardening/11-production-cutover-runbook.md` still expects "6 migrations applied" at D-1/D-2; the chain is 45 → **stale, must be updated before any production use** |

## Decisions and approvals required (not fabricated; none exist)

| # | Decision / approval | Owner |
| --- | --- | --- |
| 1 | Identify the two auth-only non-synthetic staging accounts (or approve their removal) | operator |
| 2 | Record the Supabase ticket number from the confirmation email; accept or escalate its disposition | operator |
| 3 | Scope and approve implementation of hosted MFA and recovery (the ADR-009 hosted path) | founder/security |
| 4 | Approve a key-management provider for Plaid KEK custody (for example, AWS KMS in the existing staging AWS account with a dedicated key, key policy and Plaid runtime identity), plus the Plaid runtime's hosted placement | founder/security |
| 5 | Approve hosted object storage and key custody for exports | founder/security |
| 6 | Place Stripe TEST and Plaid Sandbox credentials in the staging configuration; sign in to both dashboards for verification | operator |
| 7 | Supabase plan for production (PITR/backups, leaked-password protection) | founder/billing |
| 8 | On-call owner, incident response and rollback authority | founder |
| 9 | Legal/privacy review, penetration test, launch approval | counsel/security/founder |
| 10 | How the candidate history reaches `main` (unrelated history), or whether staging deploys continue via exact-name branch rules | founder |

## Classification

**NO-GO.** Failing or incomplete technical gates:
- hosted MFA and recovery (not mounted);
- the hosted password-policy gap (P1);
- Stripe TEST and Plaid Sandbox lifecycles (not mounted; no credentials or sessions);
- hosted export (unavailable);
- operational KMS (no approved provider);
- authenticated hosted browser matrix (operator run pending);
- the Supabase incident (open with the provider);
- backups/restore (none on staging);
- alert delivery (unproven).

"TECHNICALLY READY — AWAITING EXTERNAL APPROVAL" does not apply, because technical gates remain.

Evidence: `.evidence/staging-preprod-20260925/` (local, outside the repository; `SHA256SUMS` lists every file).
