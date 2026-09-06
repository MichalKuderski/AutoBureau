# 11 — Production Cutover Runbook

**Status:** sections A–B performed 2026-09-06 under explicit authorization. Sections C
onward are not authorized and have not been performed. **The deployment boundary (section F)
has not been crossed.**

This document is written to be followed without the conversation that produced it. Every
fact below was verified against the running systems on 2026-09-06; where something could
not be verified, it says so rather than guessing.

---

## Verified baseline

| Fact | Value | How it was established |
| --- | --- | --- |
| `main` | `5f75646` | working tree clean, local == `origin/main` |
| Staging smoke | **17/17** | run `34001299542`, against `https://autobureau-staging.vercel.app` |
| Staging acceptance | **57/57** | same run, same origin |
| Staging database | 6 migrations applied, none rolled back | queried directly; all `finished_at` predate the run |
| Production Supabase | **`ACTIVE_HEALTHY`** (`hdoknvqnjyttondgidvi`, us-east-2, PG 17.6) | resumed 2026-09-06 under section B |
| Production schema | **empty, verified before migration** | 0 public tables · no `_prisma_migrations` · 0 auth users · no `app_user`/`app_dispatcher` · no `app` schema · 0 policies |
| Production extensions | `pgcrypto` installed · `vector` available | `pg_available_extensions`; the init migration installs `vector` |
| Production deployment | **never performed** | the `production` job has been skipped on every run to date |
| Production secrets | **never exercised** | the `production` job has never run |

Staging Supabase is `kdqnfruwgocfqwpbpuxo` (us-west-2) and is `ACTIVE_HEALTHY`. It is
synthetic-only by architecture (doc 09 §1).

---

## Hard boundary

This runbook does **not** perform a cutover. Performing it requires explicit human
authorization, recorded at step **A-4** and again at **K-1**.

Nothing in sections B through K may be started on the strength of this document alone.

---

## Configuration inventory — by name only

No values appear in this document. Each item is named, classified by the system that holds
it, and marked with whether it has ever been proven to work.

### GitHub repository **secrets**

| Name | Used by | Proven |
| --- | --- | --- |
| `PRODUCTION_MIGRATION_DATABASE_URL` | production migration step | **never exercised** |
| `VERCEL_TOKEN` | all three jobs | yes — staging runs today |
| `VERCEL_ORG_ID` | all three jobs | yes — staging runs today |
| `VERCEL_PROJECT_ID` | production job only | historically resolved to the production Vercel project; not exercised since |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | smoke and acceptance | yes for staging; unproven against the production project |
| `STAGING_MIGRATION_DATABASE_URL` | staging only — **not** used by production | yes |

### GitHub repository **variables**

| Name | Used by | Proven |
| --- | --- | --- |
| `PRODUCTION_HOST` | production smoke + rollback verification | unverified |
| `STAGING_HOST` | staging only | yes |

Variables, not secrets, deliberately: a public hostname is not a credential, and filing it
as a secret would both misstate that and hide it from review (doc 09 §9.4).

### Doppler **production config** → Vercel **Production scope**

These are application runtime configuration, synced by Doppler into the *production* Vercel
project's *Production* environment scope, marked Sensitive:

`AUTH_ISSUER` · `AUTH_AUDIENCE` · `AUTH_JWKS_URL` · `AUTH_API_URL` · `AUTH_ANON_KEY` ·
`AUTH_COOKIE_NAME` · `DATABASE_URL` · `APP_ORIGIN` · `SENTRY_DSN`

`APP_ORIGIN` must be set **explicitly** in production. The derivation that covers previews
(`https://$VERCEL_URL`) fires only when `VERCEL_ENV === "preview"`; a production deployment
with no `APP_ORIGIN` throws `AuthConfigError` and the boundary answers 503. It fails closed,
loudly — it never guesses.

### Supabase database credentials

Held by Supabase, referenced only through the connection strings above.

---

## The two production PostgreSQL roles

They are different roles, with different credentials, different ports, and different jobs.
Conflating them is the single most likely configuration error in this cutover.

### Migration / admin role

- Role name shape: `postgres.<project-ref>` — the tenant suffix is required by Supabase's
  Supavisor pooler to resolve which project the connection belongs to.
- Port **5432** (session mode). `migrate deploy` takes advisory locks and issues DDL;
  transaction-mode pooling breaks both.
- Carried by: `PRODUCTION_MIGRATION_DATABASE_URL` (GitHub repository secret).
- Used by: the `Apply migrations (expand)` step **only**. Never by the running application.

### Runtime application role

- Role name shape: `app_user.<project-ref>` — same tenant-suffix rule.
- Port **6543** (transaction mode), with `?pgbouncer=true&connection_limit=1`. Both
  parameters are required: without them Prisma's prepared statements do not survive between
  statements on a transaction pooler, and every query fails.
- Carried by: `DATABASE_URL` (Doppler → Vercel Production scope).
- Used by: the running application. It is not a superuser and does not own the tables, so
  row-level security genuinely applies to it.

### `app_user` is created by the migrations — but cannot log in

Migration `20260728000001_rls` runs `CREATE ROLE app_user NOLOGIN` and grants it its table,
sequence and schema privileges. It does **not** give the role `LOGIN`, a password, or
`CONNECT` on the database, and that omission is deliberate: a migration is version-controlled
text, and a password in it would be a password in the repository.

The consequence is a step that exists in no automated path. After the migrations run,
somebody with admin access must, once per environment:

```sql
ALTER ROLE app_user WITH LOGIN PASSWORD '<chosen production password>';
GRANT CONNECT ON DATABASE postgres TO app_user;
```

Until that runs, the runtime `DATABASE_URL` cannot authenticate no matter how correctly it is
formed. The only places in this repository that perform it are the two integration-test
harnesses, both explicitly marked test-harness-only; `docs/hardening/00-ground-truth.md`
records the same behaviour. Staging works because someone did this by hand there.

**Ordering consequence.** The password in `DATABASE_URL` (section C) and the password set by
the statement above must be the same value, so it has to be chosen before C-3 and applied in
D-4. `DATABASE_URL` therefore cannot be *verified* until D-4 completes — configuring it
earlier is correct, but it is unexercised configuration until then.

---

## Invariants

Three rules that the pipeline depends on. Each was learned from a failure.

1. **`PRODUCTION_HOST` must equal the hostname portion of `APP_ORIGIN`.** The CSRF check
   compares a request's Origin against `APP_ORIGIN`; the smoke suite sends the host it was
   given. A mismatch means every state-changing request is refused with 403.

2. **Production smoke runs against the stable production origin**, never the per-deployment
   URL. Against a deployment URL, `POST /v1/auth/sign-in` answers 403 from CSRF before
   reaching the provider — and smoke still scores 17/17, because a refusal satisfies both of
   its assertions there ("never 200", "not 503"). Staging measured exactly this: 403 against
   the deployment URL, 401 against the stable origin. Only the second is evidence.

3. **`scripts/staging-acceptance.mjs` must never be run against production.** It proves the
   auth stack by *creating* identities, households, memberships, entitlements and rate-limit
   rows. Staging is synthetic-only by architecture, which is what makes that safe there.
   Against production it would write synthetic accounts into real user data and consume real
   sign-up limits. Production's equivalent is section H, performed by a human.

---

## A. Preconditions

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-1 | Confirm `main` is at the commit intended to ship and the tree is clean | git | `main` | read-only | — | `7c9bf8f` or a later commit deliberately chosen | any drift → stop and re-establish the baseline | none | no |
| A-2 | Confirm the latest staging run on that commit is green | GitHub Actions | Deploy workflow | read-only | A-1 | smoke 17/17, acceptance 57/57 | red staging → **STOP** | none | no |
| A-3 | Confirm a named person can decide on rollback and is reachable for the duration | — | — | read-only | — | named and reachable | not reachable → **STOP** | none | no |
| A-4 | Record authorization to proceed | — | — | read-only | A-1…A-3 | explicit written go | absent → **STOP** | none | **YES** |

> **STOP** — do not enter section B without A-4.

---

## B. Production Supabase provisioning

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B-1 | Resume / provision the production project | Supabase | `hdoknvqnjyttondgidvi` | **MUTATING** | A-4 | status `ACTIVE_HEALTHY` | stays inactive → **STOP** | project can be paused again; no data exists yet | **YES** |
| B-2 | Confirm the project is empty before anything is applied | Supabase SQL | `public` schema, `auth.users` | read-only | B-1 | 0 public tables, 0 auth users | unexpected content → **STOP** and establish why | none | no |
| B-3 | Confirm the required extensions are **available** | Supabase | `pgcrypto`, `vector` | read-only | B-1 | both listed as available | not available on the plan/region → **STOP**, migrations in D will fail | none | no |
| B-4 | Record the project's region and pooler hostname | Supabase | connection settings | read-only | B-1 | region recorded for use in C | — | none | no |

B-3 is deliberately read-only. Migration `20260728000000_init` issues
`CREATE EXTENSION IF NOT EXISTS "pgcrypto"` and the same for `vector`, so the migrations own
extension creation. Creating them by hand beforehand is unnecessary and introduces a second
source of truth for something the schema already declares.

---

## C. Production secrets / configuration

Nothing here is a code change. Every item is set in a console.

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-1 | Set the migration connection string | GitHub → repository **secrets** | `PRODUCTION_MIGRATION_DATABASE_URL` | **MUTATING** | B-1…B-4 | username `postgres.<ref>`, port 5432, database `postgres`, URL-safe password | wrong tenant suffix or password → D fails `P1000` | re-enter | no |
| C-2 | Create the production Doppler config | Doppler | production config | **MUTATING** | B-1 | config exists | — | delete config | no |
| C-3 | Populate runtime configuration | Doppler | `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_API_URL`, `AUTH_ANON_KEY`, `AUTH_COOKIE_NAME`, `DATABASE_URL`, `APP_ORIGIN`, `SENTRY_DSN` | **MUTATING** | C-2 | all nine present; `DATABASE_URL` uses `app_user.<ref>`, port 6543, `?pgbouncer=true&connection_limit=1` | missing `AUTH_*` → deployment answers 503 | re-enter | no |
| C-4 | Sync Doppler into the production Vercel project's **Production** scope, marked Sensitive | Doppler → Vercel | production config → production project / Production | **MUTATING** | C-3 | sync reports success | syncing to the wrong project or scope is **silent** — it will report "In Sync" against a scope the pipeline never reads | remove sync | no |
| C-5 | Set the stable production hostname | GitHub → repository **variables** | `PRODUCTION_HOST` | **MUTATING** | C-3 | no scheme; **equals the hostname portion of `APP_ORIGIN`** | mismatch → every state-changing request 403 | re-enter | no |
| C-6 | Confirm the Vercel identifiers name the production project | GitHub → repository secrets | `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_TOKEN` | read-only | — | project id is the production project, not staging | pointing at staging would deploy production code to staging | — | no |

**`DATABASE_URL` is configured here but cannot work yet.** `app_user` does not exist until
D-1 creates it, and cannot authenticate until D-4 gives it `LOGIN` and a password. Choose that
password now, use it in `DATABASE_URL` here, and apply the identical value at D-4. Between C-3
and D-4, `DATABASE_URL` is correct-but-unexercised configuration, not a working connection.

> **STOP** — C-4 and C-5 are the two most failure-prone steps in this runbook, and both fail
> silently or confusingly. Do not proceed to F without completing G's prerequisites.

---

## D. Migration / application role setup

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-1 | Run the production job's migration step | GitHub Actions → Supabase | `prisma migrate deploy` | **MUTATING** | B, C-1 | 6 migrations applied | `P1000` → credential wrong, see incident §1 | expand-only; see rollback policy | **YES** (via F's gate) |
| D-2 | Verify migration state | Supabase SQL | `_prisma_migrations` | read-only | D-1 | 6 rows, all `finished`, none `rolled_back` | any partial → **STOP** | — | no |
| D-3 | Verify the runtime role and RLS exist | Supabase SQL | `app_user`, `pg_tables.rowsecurity`, `pg_policies` | read-only | D-1 | `app_user` exists; RLS enabled on tenant tables; policies present | absent → the application cannot run safely | — | no |
| D-4 | **Grant `app_user` the ability to log in** | Supabase SQL | `ALTER ROLE app_user WITH LOGIN PASSWORD …` + `GRANT CONNECT` | **MUTATING** | D-1 | `app_user` can authenticate; password matches the one in `DATABASE_URL` | omitted → the application cannot connect at all, and every request fails at the boundary | `ALTER ROLE app_user NOLOGIN` restores the migrated state | **YES** |
| D-5 | Confirm `app_user` is not over-privileged | Supabase SQL | `pg_roles` | read-only | D-4 | `app_user` is not superuser, has no `BYPASSRLS`, and does not own the tables | any of those true → RLS does not actually constrain it — **STOP** | — | no |

The migration step is part of the production job; it is not run separately. D-1 therefore
happens inside F, and D-2/D-3 are performed immediately afterwards.

---

## E. Vercel production configuration

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-1 | The job pulls production configuration | Vercel | `vercel pull --environment=production` | read-only | C-4, C-6 | configuration downloaded for the production project | wrong project or empty scope → the build carries no runtime configuration | none | no |

Note: `--git-branch` is not passed. Vercel accepts that flag only with
`--environment=preview` and rejects it outright otherwise.

---

## F. Production deploy

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-1 | Dispatch the Deploy workflow with `environment: production` | GitHub Actions | Deploy workflow | **MUTATING** | A-4, B, C | production job starts | — | — | **YES** |
| F-2 | Approve the protected environment | GitHub | `production` environment | **MUTATING** | F-1 | job proceeds | — | decline to approve | **YES** |
| F-3 | Preflight guard passes | GitHub Actions | `PRODUCTION_HOST` | read-only | C-5 | "PRODUCTION_HOST is set." | unset → job fails **before** migrating or deploying | nothing changed | no |
| F-4 | Migrations, build, deploy | GitHub Actions → Vercel | `--prod` deploy | **MUTATING** | F-3 | deployment aliased onto the stable host | see incident section | `vercel rollback` | no |

Production cannot be reached by a push. It requires `workflow_dispatch`, an explicit
`environment: production` input, and the protected environment's approval — three
independent barriers.

---

## G. Stable-origin smoke

| # | Action | System | Item | Mode | Prereq | Expected | Failure | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-1 | Smoke the stable production origin | GitHub Actions | `https://$PRODUCTION_HOST` | read-only | F-4 | **17/17** | any failure triggers automatic rollback | automatic `vercel rollback`, then re-smoke the same origin | no |
| G-2 | Confirm the sign-in check reads 401, not 403 | smoke output | `POST /v1/auth/sign-in` | read-only | G-1 | **401** | **403 means `PRODUCTION_HOST` ≠ `APP_ORIGIN`** — the score can still be 17/17, so read this line explicitly | correct C-5, redeploy | no |

> G-2 is the check that a green score cannot give you. Read the status, not the total.

---

## H. Production acceptance — manual, human, controlled

**Do not run `scripts/staging-acceptance.mjs`.** Perform these by hand, with one controlled
account you are willing to delete afterwards.

| # | Action | Mode | Expected | Failure |
| --- | --- | --- | --- | --- |
| H-1 | Sign up a controlled address | **MUTATING** | 204; both session cookies set `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` | see incident §6 |
| H-2 | Confirm household bootstrap | read-only | `GET /v1/households/current` → 200, role `owner` | identity mirror or bootstrap failed |
| H-3 | Sign in with the correct password | **MUTATING** | **204** | 403 → CSRF/origin; 503 → configuration |
| H-4 | Sign in with a wrong password | read-only | **401** | 503 → provider or configuration |
| H-5 | Exercise refresh rotation | **MUTATING** | 303; both access and refresh tokens change; rotated session authenticates | — |
| H-6 | Sign out | **MUTATING** | 204; both cookies cleared; protected endpoint then 401 | — |
| H-7 | Delete the controlled account and its household | **MUTATING** | account and tenant rows removed | leaving it is a data-hygiene defect, not an outage |

H-7 is not optional. A synthetic account left in production is exactly the pollution this
runbook exists to avoid.

---

## I. Rollback verification

| # | Action | Mode | Expected | Approval |
| --- | --- | --- | --- | --- |
| I-1 | Confirm the previous deployment is still present in Vercel | read-only | a prior production deployment exists to roll back to | no |
| I-2 | Rehearse `vercel rollback` if this is not the first deployment | **MUTATING** | alias returns to the previous deployment; re-smoke passes at the same origin | **YES** |

On a first-ever production deployment there is no previous deployment to roll back to.
That is a material risk and should be stated explicitly at K-1: the rollback path does not
exist yet.

**Do not be reassured by GitHub's deployment list.** It contains one record labelled
environment `Production`, created by `vercel[bot]` on 2026-08-28 from commit `56cf76e`. Its
URL is `autobureau-staging-6heq6tjbn-…` — Vercel's own Git integration deploying to the
*staging* project and labelling the record "Production". It is not a deployment of the
production application and is not a rollback target. It was possible because `vercel.json`
(`github.enabled: false`) was authored 2026-08-21 but only reached `main` on 2026-09-05 with
the PR #3 fast-forward; no such record exists after that date.

---

## Rollback policy

Two different things, and they are not interchangeable.

**Vercel application rollback — safe, immediate, expected.**
`vercel rollback` moves a pointer between immutable deployments. It rebuilds nothing and
touches no schema. This is the response to a failed smoke, and the production job performs
it automatically.

**Database schema rollback — do NOT attempt automatically.**
The migrations are expand-only: they add tables, types, indexes, policies and grants, and
drop nothing. An expand-only migration does not need to be reversed to restore a previous
application version — the previous version simply ignores what it does not use. Reversing
schema under a running application is how an incident becomes data loss. If a schema change
is genuinely implicated, stop, take a backup, and decide deliberately with a human.

---

## GO / NO-GO — immediately before cutover

Every line must be **yes**. Any **no** is a NO-GO.

- [ ] `main` is the commit intended to ship, tree clean
- [ ] staging on that commit: smoke 17/17, acceptance 57/57
- [ ] production Supabase `ACTIVE_HEALTHY`, verified empty before migration
- [ ] `pgcrypto` and `vector` available
- [ ] `PRODUCTION_MIGRATION_DATABASE_URL` set: `postgres.<ref>`, port 5432
- [ ] Doppler production config populated with all nine runtime values
- [ ] Doppler synced to the **production** Vercel project, **Production** scope
- [ ] `APP_ORIGIN` set explicitly
- [ ] `PRODUCTION_HOST` set and **equal to the hostname portion of `APP_ORIGIN`**
- [ ] `VERCEL_PROJECT_ID` names the production project
- [ ] the `app_user` password is chosen, used in `DATABASE_URL`, and ready to apply at D-4
- [ ] rollback decision-maker named and reachable
- [ ] rollback target exists, or its absence is explicitly accepted
- [ ] authorization recorded

---

## J. Post-deploy observation

Watch for at least one quiet hour before K.

| Signal | Where | Healthy | Unhealthy |
| --- | --- | --- | --- |
| Errors | Sentry | no new issue groups | new groups, or a spike in an existing one |
| Authentication | Supabase auth logs | sign-ins and token grants arriving | 4xx/5xx bursts, or silence when traffic exists |
| `auth_rate_limits` | production database | **rows arriving** | **empty** |
| HTTP errors | Vercel | 5xx flat | any sustained 5xx |
| Auth failures | application | ordinary 401s | 403 clusters → origin mismatch; 503 → configuration |
| Rollback readiness | Vercel | previous deployment present | none available |

`auth_rate_limits` deserves particular attention. The limiter writes before the provider
call and fails **open** by design, so a database the deployment cannot reach is invisible in
every HTTP status — an empty table alongside real traffic is the signal, and it is the exact
symptom that hid a Prisma engine defect behind a perfect smoke score.

---

## K. Final go-live signoff

| # | Action | Mode | Prereq | Approval |
| --- | --- | --- | --- | --- |
| K-1 | Record GO / NO-GO against the checklist above | read-only | G, H, I, one clean J window | **YES** |
| K-2 | Announce live | read-only | K-1 | **YES** |

---

## If the first production deployment fails

**1 — Migration authentication failure (`P1000`).**
Read the username in the error. Supavisor consumes the `.<ref>` suffix for tenant routing
and authenticates upstream as `postgres`, so the error may name the bare role even when the
connection string is correct — do not conclude the suffix is missing from the error text
alone. Verify structure and password separately. Nothing was applied; no rollback needed.

**2 — Missing runtime variables / 503 at the boundary.**
`AUTH_*` or `APP_ORIGIN` did not reach the deployment. Almost always the Doppler sync
targeted the wrong Vercel project or the wrong scope — it reports "In Sync" either way.
Verify the sync destination is the production project's **Production** scope. Roll back the
application; the schema is unaffected.

**3 — Smoke failure.**
The job rolls back automatically and re-smokes the stable origin. If the re-smoke passes,
production is serving the previous deployment and the incident is contained. If the
re-smoke also fails, the previous deployment is also unhealthy — escalate; do not redeploy
blindly.

**4 — CSRF / `APP_ORIGIN` mismatch.**
Signature: `POST /v1/auth/sign-in` returns **403** while the smoke total still reads 17/17.
Cause: `PRODUCTION_HOST` and `APP_ORIGIN` name different origins. Correct C-5 (or
`APP_ORIGIN` in C-3) so they agree, then redeploy. Nothing is wrong with the application.

**5 — Auth provider failure.**
Signature: 503 with `AUTH_*` present, or provider timeouts. Every provider call is bounded
at 10 seconds and a hung provider surfaces as `unavailable`, not as a hang. Check the
Supabase project's auth service before assuming a deployment fault.

**6 — Deploy succeeds, manual acceptance fails.**
The pipeline is green and the product is not. Do not leave it live on the strength of a
green pipeline: roll back the application, keep the schema, and reproduce against staging —
where creating identities is safe — before trying again.

---

## What this runbook does not cover

- DNS and custom-domain configuration for the production host.
- Backup and restore procedure for production data.
- On-call rotation and escalation paths.

These are real gaps. They are named here rather than left to be discovered during a cutover.
