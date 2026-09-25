# Exact-candidate verification, staging readback and three-engine keyboard pass — September 24–25, 2026

**Pre-production decision: NO-GO.** Local engineering evidence at the exact candidate is
green — all local steps, 44/44 security mutations, the PG16/17/18 matrix and the three-engine keyboard
pass — but hosted exact-SHA acceptance, Stripe TEST and Plaid Sandbox lifecycles,
the Supabase auth incident, the ADR-019 authority and every external approval remain open
(requirement matrix below). Nothing was pushed, merged, deployed or changed in any hosted
system; hosted evidence is read-only.

## Provenance

Continues the git-less snapshot of upstream `57d079082e6a4b1854bab4d8f411300bab434f4f`
(tree `a5bac62c…`) with local history initialized over it. **Local SHAs do not exist upstream**
(`57d0790` itself returns 404 in `MichalKuderski/AutoBureau`); map evidence by tree hash.

Tested candidate: **`88829364ca5bda38630573b47cd5432b43acfa2e`**, tree `a79769ae89a3fa87816d28745b1f509fab71d957`, clean worktree.

| Commit | Change |
| --- | --- |
| `906ca1a` | Tests closing the six gaps the exact-candidate mutation suite found at `fb6bd05` |
| `a1fd832` | PRD §21.3 old-period results: explicit owner apply-this-month (one slot, capacity-checked in SQL) or discard; never automatic |
| `7267fcd` | ADR-019 journal retirement planning: holds, leased crash-recoverable planning, observations; **no purge** (`CHECK (NOT eligible)`) |
| `6b401d6` | Plaid credential envelope v2 (KMS-shaped, no downgrade); **not KMS evidence** |
| `36f6f66` | Billing grace/payment-problem states, app banner, reminder delivery status; privacy completeness control |
| `86c1ad8` | Account recovery request and landing pages (local mount only) |
| `997c176` | Auth redirects resolve against the configured origin; focus fixes found in browser verification |
| `2e9f820` | Local account mount admits a loopback-TLS app origin (still 127.0.0.1 only) |
| `6a89058` | Runtime roles lose all authority over Prisma's migration ledger |
| `19be3a0` | Opt-in `next dev` setting keeping compiled routes resident during long runs (builds ignore it) |
| `108642c` | Household deletion minimizes the retained anchor; completeness control covers every table |
| `8882936` | Privacy actions keep keyboard focus through pending requests and hand it over at once (found by the WebKit/Firefox pass at `108642c`) |

## Corrected historical record

At `fb6bd05` the exact-candidate mutation suite detected **23 of 29** mutations; six were not
detected (five test gaps, plus one whose outcome a hook timeout left undetermined). **The local
security-evidence gate therefore FAILED at `fb6bd05`.** The gaps were closed in `906ca1a` and
later commits; that run is retained unchanged
(`.evidence/mut-fb6bd05`, and the invalid first attempt without database credentials in
`.evidence/INVALID-mut-fb6bd05-missing-db-env`). No historical mutation result is reused below.

## Local validation at the candidate

`candidate.py` on a clean tree at `8882936` (evidence `cand-8882936`): every step exits 0.

| Step | Result |
| --- | --- |
| Conflict-copy check (iCloud "name 2.ext" copies), before and after | none |
| Installed dependency tree vs pinned lockfile | identical (the pre-reboot offline store is gone, so a frozen offline install is not possible; the lockfile copy in `node_modules` is compared byte-for-byte instead) |
| Build (`turbo build --force`), typecheck, lint | pass; lint 0 errors, the same 13 existing warnings |
| Unit and component tests | **2,036** (was 2,002 at `fb6bd05`) |
| Repository controls / CI guardrail steps | **206** / **7** (the secret scan uses a hosted action and cannot run locally) |
| Fresh migration, PostgreSQL 18.3 | 45 migrations |
| Restricted-role integration | **397 DB + 500 HTTP = 897** (was 862) |
| Posture readback invariants | pass: 52 forced-RLS tables, 72 policies, 46 invoker guards all pinning `pg_temp` last, no SECURITY DEFINER, BYPASSRLS only on `app_dispatcher`, 0 role memberships, no runtime-owned table, no runtime CREATE |
| Composed real-ClamAV document proof (pinned local image) | 1/1 |

The same 897 integration tests also pass on PostgreSQL 16 and 17 (DB matrix below).

## Mutation suite at the candidate

`mutations.py` at `8882936` (evidence `mut-8882936-sleepaware`): each mutation weakens one reviewed database
control, built from its live definition; the suite must fail on real assertions (0 skipped, no
file-level error), the original definition is restored and the posture hash must equal the
baseline exactly, and the same suites must then pass again.

**Result: 44/44 DETECTED** at `88829364ca5bda38630573b47cd5432b43acfa2e` (tree `a79769ae89a3fa87816d28745b1f509fab71d957`), one run under the sleep guard (`mut-8882936-sleepaware`, harness sha256 `940fe0f9ab8e…`). Every mutation changed the posture hash, failed its suites on real assertions (0 skipped, no file-level error), was restored to exactly the baseline posture and passed the positive rerun. 12 suite runs that spanned a host sleep were discarded and rerun (each recorded with its log hash); no accepted run measured more than 0.5 s of sleep. Three mutations were caught by assertions other than the predicted one (marked below); the predicted assertions are kept as written rather than edited to fit. The first run at this candidate (`mut-8882936`) straddled four sleeps, recorded 40 detected, 3 undetected and 1 invalid, and is retained but not used (see Host sleep).

| # | Mutation (group) | Predicted failing assertion | Mutated exit / failed of total | Predicted matched | Restored posture = baseline (sha256 prefix) | Positive rerun |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `data-without-lease` (current) | direct runtime SQL cannot write derived data | 1 / 2 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 2 | `commit-without-held-token` (current) | advance a cursor | 1 / 1 of 63 | **no** (other assertions failed) | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 3 | `removed-keeps-custody` (current) | removal custody rules | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 4 | `route-enumeration` (current) | routing reveals only the digest the caller holds | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 5 | `reconcile-claims-acknowledgement` (current) | no acknowledgement from reconciliation | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 6 | `webhook-after-watermark` (current) | signals newer than the claim cannot be marked applied | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 7 | `sync-lease-takeover` (current) | an unexpired lease cannot be taken over | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 8 | `custody-delete-any-state` (current) | removal custody rules | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 9 | `rotation-skips-revision` (current) | rotation must move custody and Item revision together by exactly one | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 10 | `suspension-fence-removed` (current) | administrative suspension committing during a sync | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 11 | `history-deleted-before-removal` (current) | direct runtime SQL cannot write derived data | 1 / 1 of 63 | **no** (other assertions failed) | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 12 | `removed-keeps-chosen-history` (current) | cannot commit with history left behind | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 13 | `fence-ignored-for-sync` (current) | a fence landing mid-lease stops derived writes | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 14 | `owner-cancels-reserved-work` (current) | owner cannot cancel reserved, started or indeterminate work | 1 / 1 of 29 | yes | yes (`77cbaf03a156`) | exit 0, 29/29 |
| 15 | `owner-cancels-custody-under-started-work` (current) | owner cannot cancel reserved, started or indeterminate work | 1 / 2 of 29 | yes | yes (`77cbaf03a156`) | exit 0, 29/29 |
| 16 | `viewer-may-cancel` (current) | viewers/strangers cannot cancel | 1 / 1 of 29 | yes | yes (`77cbaf03a156`) | exit 0, 29/29 |
| 17 | `deletion-undo-after-window` (extended) | refuses a non-owner deletion request and an undo after the window | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 18 | `verifier-fabricates-final-receipt` (extended) | no role can fabricate a final receipt | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 19 | `deletion-request-by-non-owner` (extended) | refuses a non-owner deletion request and an undo after the window | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 20 | `household-fence-bypass` (extended) | fence blocks raw tenant writes | 1 / 2 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 21 | `retention-erasure-unbound` (extended) | requires the settled manifested fence even for direct restricted-role DELETE | 1 / 4 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 22 | `scan-verdict-rewrite` (extended) | a terminal verdict cannot be re-queued or re-decided | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 23 | `challenge-replay` (extended) | concurrent consume commits exactly once | 1 / 1 of 24 | **no** (other assertions failed) | yes (`77cbaf03a156`) | exit 0, 24/24 |
| 24 | `export-journal-without-request` (extended) | needs the owner's exact request intent | 1 / 1 of 46 | yes | yes (`77cbaf03a156`) | exit 0, 46/46 |
| 25 | `processing-overbook` (extended) | concurrent claims cannot overbook | 1 / 4 of 29 | yes | yes (`77cbaf03a156`) | exit 0, 29/29 |
| 26 | `old-period-charged-silently` (extended) | never charged to either month without a decision | 1 / 1 of 13 | yes | yes (`77cbaf03a156`) | exit 0, 13/13 |
| 27 | `apply-ignores-capacity` (period) | refuses a recorded apply decision when the current month is full | 1 / 1 of 13 | yes | yes (`77cbaf03a156`) | exit 0, 13/13 |
| 28 | `decision-for-current-month` (period) | cannot forge, redirect or pre-empt a decision | 1 / 1 of 13 | yes | yes (`77cbaf03a156`) | exit 0, 13/13 |
| 29 | `discard-without-decision` (period) | cannot forge, redirect or pre-empt a decision | 1 / 1 of 13 | yes | yes (`77cbaf03a156`) | exit 0, 13/13 |
| 30 | `retirement-eligible-allowed` (retirement) | no role can mark a class eligible | 1 / 1 of 7 | yes | yes (`77cbaf03a156`) | exit 0, 7/7 |
| 31 | `retirement-hold-omitted` (retirement) | every open hold, including one past its review date | 1 / 2 of 7 | yes | yes (`77cbaf03a156`) | exit 0, 7/7 |
| 32 | `retirement-live-lease-takeover` (retirement) | crashed lease is taken over only after expiry | 1 / 1 of 7 | yes | yes (`77cbaf03a156`) | exit 0, 7/7 |
| 33 | `retirement-before-manifest` (retirement) | refuses to plan before the deletion manifest is sealed | 1 / 1 of 7 | yes | yes (`77cbaf03a156`) | exit 0, 7/7 |
| 34 | `credential-downgrade-allowed` (plaid-v2) | never back | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 35 | `credential-envelope-unchecked` (plaid-v2) | refuses mixed or malformed envelopes | 1 / 1 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 36 | `forgotten-household-table` (privacy-coverage) | completeness control | 1 / 1 of 18 | yes | yes (`77cbaf03a156`) | exit 0, 18/18 |
| 37 | `decision-by-non-owner` (period) | cannot forge, redirect or pre-empt a decision | 1 / 1 of 13 | yes | yes (`77cbaf03a156`) | exit 0, 13/13 |
| 38 | `tenant-policy-open` (extended) | cannot see another household even when explicitly filtering for it | 1 / 8 of 12 | yes | yes (`77cbaf03a156`) | exit 0, 12/12 |
| 39 | `audit-log-mutable` (extended) | permits insert but denies update and delete | 1 / 1 of 12 | yes | yes (`77cbaf03a156`) | exit 0, 12/12 |
| 40 | `app-reads-plaid-custody` (extended) | app_user cannot read credential custody or provider binding | 1 / 2 of 63 | yes | yes (`77cbaf03a156`) | exit 0, 63/63 |
| 41 | `ledger-runtime-write` (hardening) | no runtime role holds any authority over the migration ledger | 1 / 1 of 2 | yes | yes (`77cbaf03a156`) | exit 0, 2/2 |
| 42 | `anchor-placeholder-unchecked` (hardening) | refuses anchor minimization while household records remain | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 43 | `anchor-before-records` (hardening) | refuses anchor minimization while household records remain | 1 / 1 of 52 | yes | yes (`77cbaf03a156`) | exit 0, 52/52 |
| 44 | `forgotten-non-household-table` (hardening) | every table without household_id has a reviewed classification | 1 / 1 of 18 | yes | yes (`77cbaf03a156`) | exit 0, 18/18 |

## PostgreSQL version matrix at the candidate

`matrix.py` per server: (1) fresh apply of all 45 migrations; (2) in-place reset, then the
**staged upgrade** the hosted database will take — the first 13 migrations (the exact staging
state, same files and checksums), a staging-shaped synthetic seed (173 households, users,
profiles, owner memberships, entitlements, 213 members, 755 audit rows, 7 live rate-limit buckets,
no documents; every address `@example.test`), the repository's read-only upgrade preflight, then
the remaining 32; (3) a posture snapshot of each and a diff that must be empty. The
**Supabase-shaped** variant runs every migration as a non-superuser `postgres` owner with
CREATEROLE/CREATEDB/BYPASSRLS (as on staging), with `anon`/`authenticated`/`service_role`/
`authenticator`, `pgcrypto`/`uuid-ossp` in `extensions`, `vector` in `public` and provider-style
default privileges for the API roles.

| Server | Owner running migrations | Fresh apply | Staged 13 → seed → preflight → 32 | Ledger | Seeded data | Posture fresh vs staged |
| --- | --- | --- | --- | --- | --- | --- |
| PG 16.15 (CI major) | superuser | pass | pass (32 in 1.8 s) | 45/45, checksums = files | unchanged (8 tables, content digests) | identical |
| PG 17.11 | superuser | pass | pass (1.6 s) | 45/45 | unchanged | identical |
| PG 17.11 Supabase-shaped | non-superuser `postgres` | pass | pass (1.7 s) | 45/45 | unchanged | identical |
| PG 18.3 (local) | superuser | pass | pass (1.7 s) | 45/45 | unchanged | identical |
| PG 18.3 Supabase-shaped | non-superuser `postgres` | pass | pass (1.5 s) | 45/45 | unchanged | identical |

Cross-version: PG16 and PG17 postures are identical; PG18 differs only in extension versions and
pgcrypto 1.4's extra `fips_mode()`. In the Supabase shape the only invariant exceptions are the
provider's own (`service_role` BYPASSRLS, `authenticator` memberships, and the PG16+ automatic
admin membership of the creating `postgres` in each app role); API roles hold no table or
column privilege, only default sequence privileges (not exposed by the Data API).

Integration suites on the older servers: the full restricted-role suites pass on both — PG16: 397 DB + 500 HTTP; PG17: 397 DB + 500 HTTP (each suite asserts the server major it ran against).

Limitations: Docker images `pgvector/pgvector:pg16` (16.15) and `:pg17` (17.11) and Postgres.app
18.3 are not the provider's build; the Supabase shape reproduces the roles, schemas and privilege
defaults that matter to these migrations, not the provider's extensions or `supautils` hooks.
Staging itself was only read.

## Keyboard-only browser verification (local synthetic stack)

**Scope:** `next dev` at the candidate (local synthetic account mount), the loopback QA identity
issuer (GoTrue-shaped, ES256, synthetic users only) and a QA PostgreSQL 17 database migrated to
all 45 migrations. **This is not hosted or provider evidence.** Served over loopback TLS
(self-signed RSA certificate for 127.0.0.1, `ignoreHTTPSErrors` in the harness): the session
cookie is `Secure` unconditionally and WebKit on macOS stores no `Secure` cookie over plain-HTTP
loopback. Measured before the change: WebKit rejected `document.cookie` with `Secure` on
`http://127.0.0.1`, and its sign-up landed back on sign-in, while Chrome and Firefox kept the
cookie. `2e9f820` lets the local-only mount accept an `https://127.0.0.1` origin; every other
refusal is unchanged and pinned by tests.

Every hop is a real key press (Tab; Option+Tab in WebKit, whose default Tab reaches only text
fields; Firefox with `accessibility.tabfocus=7`); nothing is focused by script. Checks that
depend on an earlier step are reported **blocked**, never passed; an audit of a page that
redirected (for example to sign-in) is a failure. Harness sha256 `d17fcde0…` for the recorded `8882936` run, `620b6a90…` for the Firefox rerun (adds only the E precondition).

Flows: **A** sign-up and onboarding (focus on each step heading, new-person field); **B** MFA
enroll, challenge, verify to AAL2, replay refusal, factor/session mismatch refusal; **D**
recovery request, weak and k-anonymity-breached passwords refused without consuming the
one-use link, success, reuse refused, old password refused, new password accepted, pre-recovery
session revoked; **C** step-up, last required factor protected (a second member makes MFA
required), removable factor removed with forced sign-out; **E** destructive confirmation (open
by keyboard, focus inside, trap, disabled until the typed phrase, Escape restores focus,
schedule, focus to Undo, no erasure/receipt claim, undo restores focus); **sweep** of nine
pages in light and dark (h1, accessible names, text contrast AA) and reflow at 390 px, 320 px
and 640×450 CSS px (the 200% zoom equivalent of 1280×900), with reduced motion emulated.

| Run (candidate) | Chrome 153 | WebKit 26.6 | Firefox 155 | Note |
| --- | --- | --- | --- | --- |
| `19be3a0` (before E existed) | 125/125 | 125/125 | 124/125 | Firefox: one 60 s navigation timeout while the host was loaded |
| `108642c` | 132/132 | **131/132** | **131/132** | WebKit and Firefox: focus on `<body>` after Undo deletion — real defect, fixed in `8882936` |
| `8882936` (recorded) | **132/132** | **132/132** | 123/132, 2 failed, 9 blocked | Firefox: the `mfa.ip` limiter (60 per 15-minute window per IP) answered 429 in the last-factor step after back-to-back full passes from 127.0.0.1; E then signed in with a factor still enrolled (the harness now blocks E in that case) |
| `8882936` (Firefox rerun, fresh window) | — | — | **132/132** | Same candidate; harness differs only by the E precondition |

Every failed and blocked result above is retained with its JSON. The 429 is the product's
per-IP account-security limit working as designed under test load, not a defect.

Not claimed: WCAG conformance, screen-reader output (no VoiceOver/NVDA run), real 200% browser
zoom (viewport equivalent only), motion behaviour beyond the emulated preference, and anything
about the hosted build. `next dev` artifacts seen and not attributed to the product: route
recompilation latency, P2028 interactive-transaction expiry under compile load, loopback
redirects rewritten from `127.0.0.1` to `localhost` by Next's URL normalization, and the dev
overlay's focusable portal.

## Hosted staging: read-only evidence (2026-09-25 UTC)

Operator-authorized, staging-only, **read-only**. Access was through the operator's own signed-in
browser sessions; no credential was typed, copied or stored, and no hosted write was made. The
Supabase SQL editor (which no longer auto-saves snippets) ran one reviewed `SELECT`
(`.verification/staging-readback.sql`, sha256 `5852dfd9…6c72`; the editor buffer hashed to the
same value before it ran). It returned counts and catalog metadata only.

| Check | Result |
| --- | --- |
| Project | `kdqnfruwgocfqwpbpuxo` ("AutoBureau", us-west-2, NANO, Free plan). "AutoBureau Production" (us-east-2) is paused and was not opened. |
| Server | PostgreSQL **17.6**; `postgres` is **not** superuser (CREATEROLE, BYPASSRLS) |
| Ledger | **13 applied** (`20260728000000_init` … `20260913000002_api_role_table_privileges`), all finished, none rolled back; each checksum equals the SHA-256 of the source file. **Source has 45; 32 pending.** |
| Upgrade preflight (repo `upgrade-preflight.sql`) | `ok: true`, no blocking condition; 0 documents, 0 nonzero legacy usage, 0 TEST billing journals; no delta role pre-exists |
| Tenant-parity FKs of `20260921000003` | 0 mismatches in chunks/items/obligations/reminders |
| Rows | 173 households, 173 users, 0 documents/items/obligations/reminders/chunks/secrets/inbound mail |
| Real-data check | **172 user addresses match the synthetic pattern; 1 does not.** It was not read. It must be identified by the operator before any hosted mutation (step 7 of the pre-check). |
| Extensions | `vector` 0.8.2 in `public`; `pgcrypto`, `uuid-ossp`, `pg_stat_statements` in `extensions`; the delta calls only core `sha256/encode/convert_to`, no pgcrypto function |
| Event triggers | the six Supabase-owned ones only; the out-of-band `ensure_rls` trigger removed by `20260906000000` is absent |
| Data API | enabled, `public` exposed; **0 of 25 tables and 0 of 93 functions exposed** to API roles; automatic exposure of new tables off |

**Security Advisor** (0 errors, 5 warnings), with dispositions (none suppressed):

1. `app.current_household`, `app.current_user_id`: mutable `search_path`. Bodies call only
   `pg_catalog` built-ins, which resolve first and cannot be shadowed from `pg_temp`; runtime
   roles hold no CREATE on any schema. Pinning `SET search_path` would stop these SQL functions
   from being inlined into every RLS predicate. **Accepted with rationale; revisit with a
   measured plan comparison.**
2. `vector` in `public`: moving it changes type resolution for existing columns. No API role can
   execute its functions (0/93 exposed). **Accepted; recorded.**
3. `auth_rate_limits` always-true policy: documented design (ADR-013 D4) for a pre-principal
   table; API roles hold no grant (0/25). **Accepted; role-scoping the policy is an optional
   defense-in-depth follow-up.**
4. Leaked-password protection disabled: a Pro-plan feature. The application's own k-anonymity
   check covers its sign-up and recovery paths, but not a client calling Auth directly with the
   anon key. **Open for Production.**

**Hosted Auth configuration** (read-only; staging values, not changed):

- Sign-ups allowed; **email confirmation off**; manual linking off; anonymous sign-in off.
- Email provider: **minimum password length 6, no character requirements**, secure email change
  on, **secure password change off**, leaked-password protection off (Pro only), CAPTCHA off.
- MFA: TOTP enroll/verify enabled (10 factors max), SMS MFA off, **AAL1 sessions of users with
  factors limited to 15 minutes** (the local issuer does not model this).
- URL configuration: Site URL `https://autobureau-staging.vercel.app`; allow-list
  `https://autobureau-staging.vercel.app/**` **and `http://localhost:3000/auth/callback`**.
  Preview deployment URLs are not allow-listed, so auth emails from a Preview redirect to stable
  staging.

These are acceptable for synthetic staging but are **release items for Production**: confirmation
on, minimum length ≥ the application policy, secure password change on, leaked-password
protection (Pro), CAPTCHA decision, and an allow-list without `localhost`.

**Deployment state** (read-only): the stable staging project `autobureau-staging` serves the
September 12 deployment "fix(auth): complete email confirmation server-side (#4)"; the Deploy
workflow's recent runs are Preview syncs of PR #5 (`codex/launch-foundations`). The candidate's
history exists only locally, and its snapshot base `57d0790` is not in `MichalKuderski/AutoBureau`
(404). Staging migrations run only through `deploy.yml` (`staging` job, `migrate deploy` with the
`STAGING_MIGRATION_DATABASE_URL` secret), and applying the delta without deploying the matching
application would put the September 12 build against a schema it was never tested with.
**Hosted apply and exact-SHA acceptance therefore need push + workflow-dispatch authorization,
reconciliation of the local history with the GitHub repository, and the operator's answer on the
one non-synthetic account.** Nothing was pushed or dispatched.

Stripe and Plaid dashboards had no signed-in session; no provider work was attempted.

## Staging migration plan (reviewed, NOT executed)

The seven pre-checks for a hosted schema mutation, as they stand:

| # | Pre-check | State |
| --- | --- | --- |
| 1 | Target project/environment | Verified read-only: `kdqnfruwgocfqwpbpuxo`, staging, PG 17.6 |
| 2 | Exact candidate SHA | `8882936` exists only locally; the deploy path needs it on GitHub (**blocked: push authorization and history reconciliation**) |
| 3 | Staging migration state vs source | 13 applied = first 13 source files byte-for-byte; 32 pending |
| 4 | Saved/reviewed plan | This section; delta rehearsed as the staged upgrade on PG16/17/18 and as a non-superuser Supabase-shaped owner, with a staging-shaped seed and seeded data unchanged; the 32 migrations take 1.5–1.8 s |
| 5 | Lock/statement bounds | 29 of 32 pending migrations set `lock_timeout` 5 s and a statement timeout; **3 do not** (`20260921000000`–`…0002`: function replacement, grants, `CREATE POLICY`/`CREATE TRIGGER`, the latter taking brief AccessExclusive locks on `notifications`/`notification_deliveries`). Apply only in a confirmed-idle window (staging showed 0 requests/24 h, 5/60 connections) or with session-level bounds on the migration connection; historical migration files are not edited |
| 6 | Rollback/disable | Forward-fix only (each migration states it); the application build must move with the schema. The September 12 build must not run against the new schema: `deploy.yml`'s staging job applies migrations and then deploys the matching build |
| 7 | No real user data endangered | Delta modifies no existing user row and drops no table/column; parity FKs validate with 0 mismatches; but **one non-synthetic address exists** and must be identified by the operator first |

Order when authorized: operator identifies the account → push the candidate to a reviewed branch
(history reconciled with `MichalKuderski/AutoBureau`) → dispatch `deploy.yml` `staging`,
`stage=migrate` → run the repository preflight and posture readback against staging →
`stage=deploy` → stable-staging acceptance at the exact SHA → Security Advisor rerun
(dispositions above; nothing suppressed).

## Critical-path status

| Item | What exists at the candidate | What is blocked, and by what |
| --- | --- | --- |
| PRD §21.3 old-period results | Immutable result held as **action required**; owner's explicit "Apply this result this month" consumes exactly one current-month slot, checked in SQL under the processing-quota lock, reusing the result (source hash, scan provenance, versions, citations, review history); without capacity it stays held and nothing is recorded; discard never charges and keeps the original upload; concurrent, replayed and racing applies charge at most once; deletion fence, suspension and custody expiry each fail closed without losing the result. Restricted-role DB and HTTP tests (`document-period`, `document-result`) and 5 mutations | — |
| Journal retirement (ADR-019) | Classes, replay horizons (engineering proposals), content-minimized evidence, bounded leased planning with crash takeover, deletion and incident holds, independent observations | **Purge blocked**: no independent restore authority; `CHECK (NOT eligible)` |
| Plaid custody | Reviewed v2 envelope (KMS-shaped key reference, no downgrade), lifecycle with deterministic Sandbox-shaped adapters | **No operational KMS** (no real key/IAM path); **no Plaid Sandbox provider run** (no session) |
| Export / deletion | Export v3 (originals + JSONL + manifest), identifier policy (counts, never values), artifact lifecycle; deletion request/undo/fence/erasure stages; inventory completeness for every table; account-vs-household scope stated; retained evidence content-free including the household anchor; provider/backup status "unverified" | **No final receipt** (`finalReceiptIssuable=false`); **no export-ready notification** (no producer); provider/backup erasure unverified |
| Reminder and billing-grace UI | Grace banner, grace-expiry and payment-problem states, reminder/delivery status, old-period "Action required" with apply/discard, all from durable state | Reminder **delivery pipeline absent** (UI says so); Stripe TEST provider lifecycle not run |
| MFA/recovery, keyboard | Enrollment, challenge, verify to AAL2, factor removal, last-factor protection, recovery request/redemption, password update, forced sign-in, replay and mismatch refusal — Chrome, WebKit, Firefox | Hosted Auth (AAL1 15-minute limit, email templates) not exercised |
| Accessibility matrix | Keyboard flows incl. destructive confirmation, names, h1, contrast in light/dark, reflow at 390/320 px and 200%-equivalent, reduced motion emulated — three engines | Screen reader not run; not a WCAG claim |

## Supabase auth incident

Disposition: **unresolved release blocker.** Nothing new was learned from the provider: the three
September 13 gateway 504s on `/auth/v1/signup` and `/auth/v1/token` still have no matching
`auth_logs` request, and later successful sign-ins are not a resolution. Staging showed
"Unhealthy" briefly while its overview loaded and "Healthy" after; that is recorded, not
interpreted. The support packet (`docs/engineering/supabase-support-packet-20260920.md`) remains
**unsent**: sending it to Supabase is outside the staging-verification authorization and needs
your separate, explicit go-ahead. No credential retries or longer timeouts were added.

## Defects found and fixed in this continuation

| Found by | Defect | Fix |
| --- | --- | --- |
| Mutation suite at `fb6bd05` | Five controls had no test that failed when they were weakened; one Plaid test's hook timeout hid the result | Tests in `906ca1a` (non-owner deletion INSERT, undo after window, terminal scan rewrite, export journal without intent/with long expiry, suspension release in `finally`) |
| Browser (Chrome) | Signed-out redirects resolved against the Host-derived origin, sending loopback users to another origin | `997c176`: middleware and refresh/callback/confirm resolve against the configured origin |
| Browser (all) | Focus fell to `<body>` after MFA enrollment and verification, after onboarding step changes, and after adding a household member | `997c176`: status and heading focus, new-person field focus |
| Browser (WebKit) | No `Secure` session cookie over plain-HTTP loopback, so the local stack could not be verified in WebKit at all | `2e9f820`: local-only mount accepts `https://127.0.0.1`; stack served over loopback TLS |
| Staging readback + review | Runtime roles (`app_user`, `app_dispatcher`) could write Prisma's migration ledger, and could therefore mark a pending security migration as applied | `6a89058`: revoke, pinned by a restricted-connection test and a mutation |
| Privacy review | Household deletion kept the household name and inbound alias in the retained anchor | `108642c`: blind, manifest-bound anchor minimization; status reports it from the row |
| Privacy review | The completeness control ignored tables without `household_id` (identifier secrets, uploads, deliveries, account-scope tables) | `108642c`: every table classified; `household-via` tables must cascade and be inventoried |
| Browser (WebKit, Firefox) | After Undo deletion, keyboard focus fell to `<body>`: the pending control was natively disabled (dropping focus) and focus moved only after a background refetch; Chrome passed by timing | `8882936`: pending controls in the deletion and export cards are `aria-disabled` with click guards; focus is handed over as soon as the new state renders; a component test holding the request and refetch open fails on the old card |
| Harness | A check could pass vacuously when its setup failed; the accessibility sweep could audit a redirected sign-in page | Blocked/not-reached states; page identity asserted before auditing |
| Harness / dev server | `next dev` evicted compiled routes after 60 s, so flows failed on recompilation latency and P2028 | `19be3a0`: opt-in `NEXT_DEV_KEEP_ROUTES` (builds ignore it) |

Environment, not product: the first loopback certificate carried explicit EC curve parameters
(LibreSSL default), which TLS clients reject; replaced with RSA. Firefox leaves the document
at the end of the Tab order instead of wrapping; the harness traverses backwards from there.

## Findings recorded, not fixed

- **One-use recovery `token_hash` in request logs.** The landing URL carries it in the query
  string, so any request log (the dev log here; hosted request logs or drains) holds a live
  one-use token until it is redeemed or expires. Redemption needs the authenticator code when a
  factor exists; for an account without a factor the token alone suffices. Mitigation proposal:
  a fragment-based template link plus a landing page that reads and clears `location.hash`
  (needs a hosted email-template change).
- `user_profiles` (and `users` via a permissive app policy) rely on the application session
  layer, not RLS: documented design (migration `20260728000001`, test M7), recorded as residual.
- `app.guard_owner_document_cancel()` is executable by `PUBLIC`; it is a trigger function and
  cannot be invoked directly. Cosmetic.
- On a Supabase-shaped database, new sequences inherit API-role default privileges (tables do
  not); no sequence is reachable through the Data API.
- A recovered Chrome transport retry (`ERR_TOO_MANY_RETRIES`) was seen twice at the first sweep
  navigation on the loopback dev server in earlier runs; not seen in the recorded run.
- No notification producer exists for finished exports; reminders are never created (delivery
  pipeline absent). The UI states both honestly.

## Host sleep (environment)

This Mac ran on battery with the lid closed for most of September 25: `pmset` shows "Clamshell
Sleep" at 08:48:25, then "Maintenance Sleep" of 922–929 s with 40–45 s dark wakes, repeating.
The first exact-candidate mutation run (`mut-8882936`) straddled four of those sleeps: the four
mutations it recorded as UNDETECTED/INVALID completed within seconds of the four wake-ups, their
suites showing hook timeouts and ~928 s file durations, and PostgreSQL logged a silent gap of
the same length. That run is kept on record and is **not** used as evidence either way. The
harness now measures each suite run's sleep (wall clock minus macOS monotonic time, which stops
during sleep), discards and reruns any run that spanned a sleep, and records every discard. The
browser runs, the candidate suite and the DB matrix ran while the machine was awake (no sleep
entries in their windows).

## External requirements (audited; none approved by this work)

No human approval was invented. Each item below needs a named person or organization and
evidence that this repository cannot produce.

| Requirement | Status | What would close it |
| --- | --- | --- |
| Legal entity / operator of record | OPEN | Named entity, registration, jurisdiction of operation |
| Jurisdiction and applicable law (privacy, consumer, financial data) | OPEN | Counsel memo; DPIA if EU/UK residents in scope |
| Public contacts (support, privacy, security) | OPEN | Monitored addresses published in the ToS/privacy notice |
| Terms of Service and Privacy Notice | OPEN | Counsel-approved text matching actual retention/deletion behaviour (ADR-019 limits, retained evidence classes, provider copies) |
| Independent penetration test | OPEN | Scoped test of the exact release candidate on stable staging; findings triaged |
| Incident response plan | OPEN | Written plan, severity levels, breach-notification timelines, contacts |
| On-call / escalation | OPEN | Named rota and paging path |
| Backup and restore drill | OPEN | Restore of a staging backup to a scratch project with a timed runbook; staging shows "No backups" on the Free plan |
| Subprocessor / provider approvals (Supabase, Vercel, AWS, Stripe, Plaid, model provider) | OPEN | DPAs signed; Plaid Production application and review; Stripe account activation |
| Pricing and cap confirmation | OPEN | Founder sign-off of the plan catalog values and quota caps |
| Support readiness | OPEN | Support channel, macros for deletion/export/MFA recovery requests, identity-verification procedure |
| Monitoring and alerts | OPEN | Alerting on auth errors (incl. the Supabase 504 class), 5xx rate, queue age, export/deletion job age |
| Cost controls | PARTIAL | AWS $100/month limit recorded; Supabase/Vercel spend caps and alerts not evidenced |
| Supabase auth incident disposition | UNRESOLVED RELEASE BLOCKER | Provider root cause, or provider-acknowledged issue with accepted mitigation, or formal residual-risk acceptance; the prepared support packet is **unsent** and needs separate explicit authorization |
| Production auth configuration | OPEN | Confirmation on, password minimum ≥ app policy, secure password change, leaked-password protection (Pro), CAPTCHA decision, allow-list without localhost |
| ADR-019 independent restore/erasure authority | OPEN | Selection and approval of the authority; until then no purge, no final receipt |
| KMS for Plaid credential custody | OPEN | Real key, IAM path and rotation evidence (the v2 envelope is a reviewed format, not KMS evidence) |

## Requirement matrix

| Criterion for PRE-PRODUCTION GO | Status | Evidence / gap |
| --- | --- | --- |
| Local suite at the exact candidate | **PASS** | `cand-8882936`, all steps exit 0 |
| Mutation / security-negative suite at the exact candidate | **PASS** | 44/44 detected, `mut-8882936-sleepaware`; the sleep-affected first run is retained, not used |
| PostgreSQL matrix (PG16/17/18, fresh + staged + posture) | **PASS (local)** | `dbmatrix-8882936`; not the provider's build |
| Staging migration compatibility | **PARTIAL** | Read-only readback and preflight pass on staging; the delta is rehearsed locally; the hosted apply is blocked (push/dispatch authorization, history reconciliation, one non-synthetic account) |
| Supabase Security Advisor after staging changes | **BASELINE ONLY** | No staging change was made; 0 errors, 5 warnings with dispositions |
| Hosted exact-SHA staging acceptance | **BLOCKED** | Stable staging serves the September 12 build |
| Stripe TEST provider lifecycle | **BLOCKED** | No signed-in session; nothing run against Stripe |
| Plaid Sandbox provider lifecycle | **BLOCKED** | No signed-in session; Sandbox-shaped adapters only |
| Export / deletion / privacy | **PASS (local), NOT COMPLETE** | Anchor minimization and full-table completeness added; no final receipt; provider/backup erasure unverified; no export-ready notification |
| Accessibility / keyboard | **PASS (local, three engines)** | Screen reader, real zoom and hosted build not covered |
| Security posture | **PASS (local)** | Runtime ledger authority removed; no SECURITY DEFINER; forced RLS where designed |
| Supabase incident disposition accepted | **FAIL** | Unresolved release blocker; packet unsent |
| External approvals | **FAIL** | None evidenced (table above) |
| No open P0/P1 | **FAIL** | Hosted acceptance, provider lifecycles, the incident and the ADR-019 authority are open release blockers |

## Decision

**NO-GO.** Local engineering evidence at `8882936` is green, and **the local security-evidence gate is PASS** at
this candidate (it FAILED at `fb6bd05`), but PRE-PRODUCTION GO
requires every row above, and hosted acceptance, both provider lifecycles, the Supabase incident
disposition and every external approval are unmet. "TECHNICALLY READY — AWAITING EXTERNAL
APPROVAL" does not apply either: the hosted and provider gates are technical gates that have not
run.

What would move this forward, in order:

1. **You:** identify the one staging user whose address does not match the synthetic pattern
   (it was not read), or authorize its removal from staging.
2. **You:** decide how this local history reaches `MichalKuderski/AutoBureau` (its base `57d0790`
   is not there), and authorize the push and the `deploy.yml` staging dispatch
   (`stage=migrate`, then `stage=deploy`) under the plan above.
3. **You:** sign in to Stripe (TEST) and Plaid (Sandbox) in the browser pane so their lifecycles
   can run against the providers.
4. **You:** decide whether to send the Supabase support packet (separate authorization).
5. Then: stable-staging acceptance at the exact SHA, the Security Advisor rerun, and the external
   items (legal, pen test, incident response, backups, approvals).

## Environment

Toolchain rebuilt after the September 24 reboot wiped `/private/tmp`, each artifact verified before
use: Node 22.16.0 (SHASUMS256 and Developer ID), pnpm 10.34.5 (npm integrity and registry
signature), Playwright 1.63.0 with WebKit 26.6 and Firefox 155 (downloads approved by you),
Docker images `pgvector/pgvector:pg16`/`:pg17` (approved), Postgres.app 18.3 and the pinned local
ClamAV image. The Desktop is iCloud-synced and produced "name 2" conflict copies in generated
directories, so the evidence cluster and TLS material live under `~/.pellum-local`, and the
candidate harness fails on any conflict copy outside generated output. Harness and evidence:
`Desktop/Pellum-current-source/.verification` and `.evidence` (outside the repository).
