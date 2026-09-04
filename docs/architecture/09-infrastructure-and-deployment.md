# 09 — Infrastructure & Deployment

## 1. Environments

| Env | Purpose | Data |
|---|---|---|
| `local` | docker-compose: Postgres+pgvector, Redis, Mailpit, MinIO(storage-compat), fake-LLM mode + optional real keys | synthetic seed |
| `preview` | Vercel preview per PR, pointing at `staging` backend with a per-PR schema-branch (Supabase branching) | synthetic |
| `staging` | full stack, production-shaped, scaled to minimum | synthetic + anonymized fixtures only — **never production data** |
| `production` | | real |

Hard rule: no production PII in any non-production environment, enforced socially *and* by network policy (staging AI service has no route to prod DB) — this is the rule most startups break in month 6; writing it down is the cheap part, the network policy is the real control.

## 2. Terraform layout

```
infra/terraform/
  modules/            # network, ecs-service, redis, cloudflare-zone, kms, monitoring
  envs/
    staging/          # backend: S3 + DynamoDB lock, per-env state
    production/
```

Terraform owns: AWS (VPC, ECS cluster/services/autoscaling, ALB, ECR, KMS keys, S3 backup bucket, IAM roles, Secrets Manager mirrors, CloudWatch alarms), Cloudflare (zone, DNS, WAF rules, Email Routing, Turnstile), Upstash (via provider), Grafana Cloud alert rules. Vercel and Supabase are configured via their own config-as-code surfaces (`vercel.json`, Supabase config + SQL migrations) — their Terraform providers are shallow enough that pretending otherwise creates drift; the boundary is documented here deliberately.

Apply model: `terraform plan` on PR (posted as comment), `apply` on merge to `main` via GitHub Actions with OIDC → AWS (no long-lived cloud keys in CI). Production applies require environment approval (GitHub protected environment).

## 3. Networking (AWS side)

- VPC with private subnets for ECS tasks; ALB in public subnets behind Cloudflare-proxied `ai.autobureau.com`. **Edge split (review A7/F-03):** `app.autobureau.com` is DNS-only to Vercel — no Cloudflare proxy in front of Vercel (double-CDN causes challenge loops and cache-header pathologies) — protected by Vercel's WAF + rate limiting; Cloudflare fully proxies only `in.autobureau.com` (Email Routing), `ai.autobureau.com` (chat SSE edge), and marketing. The ALB is treated honestly as **public-with-auth**: the short-lived scoped JWTs (doc 06 §6) are the control; no shared-egress-range allowlist theater (F-15).
- NAT gateway for egress (model providers, Supabase). Egress allowlist by domain via proxy is a phase-2 hardening item (doc 12 §9).
- No SSH; ECS Exec (audited) for break-glass.

## 4. CI/CD (GitHub Actions)

```
PR:  turbo affected → lint • typecheck • unit • contract tests
     ruff • pyright • pytest (AI service)
     prisma migrate diff (fails on drift) • oasdiff (contract break check)
     docker build (AI) → trivy scan
     Vercel preview deploy → Playwright smoke against preview
     gitleaks • CodeQL • osv-scanner
main: everything above +
     prisma migrate deploy → staging; deploy AI image → staging ECS
     Playwright full suite + k6 smoke against staging
     eval-gate check if prompts/routes changed (doc 11 §5)
     → production: Vercel promote + ECS rolling deploy (approval-gated)
```

- Deploy order is always: migrations (expand) → services; contract phase ships in a later release (doc 09 §6).
- Rollback: Vercel instant rollback; ECS previous task-def; migrations are forward-only — a bad migration rolls forward with a fix (practiced in staging, not invented during an incident).

## 5. Secrets

Doppler as source of truth (per-env configs, audit log, access via SSO) → syncs to Vercel env vars and AWS Secrets Manager (ECS task injection). Rules: no secrets in repo or CI logs (gitleaks in CI); quarterly rotation calendar; per-service least-privilege tokens; the Anthropic/OpenAI keys are per-env with separate spend limits so a leaked staging key can't torch the production budget.

## 6. Database migration discipline

- Expand → migrate → contract for anything breaking; contract step ships ≥1 release later.
- Every migration PR states: lock impact (`ACCESS EXCLUSIVE`?), table size at 100k households, rollback story. `CREATE INDEX CONCURRENTLY` outside transactions via the escape hatch.
- RLS policies & triggers versioned in the same migration stream as schema (doc 02, doc 06 §5).

## 7. Backups & DR

- Supabase PITR (7-day window) **plus** nightly `pg_dump` to our own S3 (cross-account, versioned, 35-day lifecycle, KMS) — the "Supabase has a very bad day" hedge.
- Storage buckets replicated nightly to the same S3 (rclone job).
- Quarterly restore drill: restore latest dump into a scratch project, run the smoke suite against it, record RTO/RPO actuals. Targets: RPO ≤ 24 h (dump) / ≤ 5 min (PITR), RTO ≤ 4 h.
- DR is single-region restore, not multi-region failover — honest for this stage; multi-region is a doc-14 trigger.

## 8. Runtime configuration & flags

PostHog feature flags for product gating; a small `app_config` table (cached 60 s) for operational toggles (model routes, thresholds, budgets) so AI tuning is config-deploy, not code-deploy. Flag debt review monthly — flags older than 90 days get deleted or promoted.

---

## 9. As implemented (P1-01)

Sections 1–8 describe the target. This section describes what the repository actually
contains, what it does not, and what has not been proved. It is written separately rather
than folded upward because the difference between a design and a running system is exactly
what a deployment document is for — and because before P1-01 this repository had no
deployment configuration of any kind, so every production characteristic below §9 was
unmeasured.

**No decision was made here.** ADR-001 and §§1–5 above already name Vercel as the host for
`apps/web`, `vercel.json` as its config-as-code surface, Doppler as the secret source,
forward-only migrations, and Vercel instant rollback. P1-01 implements that; it does not
choose it. No ADR accompanies this section for the same reason.

### 9.1 What exists

| Artifact | Purpose |
|---|---|
| `vercel.json` | Host configuration: `pnpm install --frozen-lockfile`, `pnpm turbo run build --filter=@autobureau/web...`, output `apps/web/.next`, region `iad1` (US — doc 13 residency), Vercel's own Git integration **disabled** |
| `.github/workflows/deploy.yml` | Preview on PR, staging on merge to `main`, production by approval-gated dispatch |
| `scripts/smoke-deployment.mjs` | The post-deploy gate, run against every environment |
| `.env.example` §deployed environments | Which variable belongs to which environment, and why |

`ci.yml` is unchanged. Correctness gates and deployment are separate workflows on purpose:
CI must keep running for forks and for commits nobody intends to ship, and merging the two
would expose deployment credentials to every pull-request run.

**GitHub Actions is the only deployment authority.** `vercel.json` sets
`github.enabled: false`, so Vercel's Git integration cannot deploy in parallel. Two
triggers would mean a push could reach production without passing the gates below.

### 9.2 What is deliberately absent

- **No Dockerfile for `apps/web`.** It is a Next.js application on Vercel (ADR-001, doc 01
  §55). A container image would be a second, competing deployment path for the same
  deployable. The escape hatch — relocating `/v1` to a Node service — is a doc-14 trigger
  with its own decision, not a file to keep warm.
- **No `infra/terraform/`.** §2's Terraform owns AWS/ECS/Cloudflare, which exist to run
  `services/ai`. That service does not exist yet. Terraform for an absent service would be
  infrastructure describing nothing, and the repository's own rule is that directories are
  created when the work that needs them is authorised.
- **No `fly.toml`, no Kubernetes manifests.** Neither is in the architecture.
- **The AI half of §4's pipeline** (ruff/pyright/pytest, image build, trivy, ECS rolling
  deploy) is absent for the same reason: `services/ai` does not exist.

### 9.3 Environments and promotion

| Environment | Trigger | Database | Auth configured |
|---|---|---|---|
| `local` | `pnpm dev` | docker-compose Postgres | no — `/v1` answers 503 |
| `preview` | every pull request | staging database | yes |
| `staging` | merge to `main` | staging database | yes |
| `production` | manual dispatch + protected-environment approval | production database | yes |

```
PR ──▶ preview  ──(merge)──▶ staging ──(human approval)──▶ production
        smoke              migrate → deploy → smoke      migrate → deploy → smoke → rollback-on-failure
```

Promotion is a person approving a named commit, not a timer. Production is never reached
by a push alone.

`APP_ORIGIN` is per-deployment and is compared against by the CSRF check, so a preview that
claims production's origin rejects its own form posts. That derivation cannot live in
configuration: a Vercel environment variable is a literal string and `$VERCEL_URL` in its
value is not interpolated, so one stored value cannot follow the different host every
preview gets. `authConfigFromEnv` derives it instead — `https://$VERCEL_URL`, and only when
`VERCEL_ENV` is exactly `preview`. **Preview therefore leaves `APP_ORIGIN` unset**; every
other deployed environment sets it explicitly, an explicit value always wins, and outside
preview there is no fallback, so a production deployment that loses it answers 503 rather
than trusting its own `*.vercel.app` deployment URL. `VERCEL_URL` is safe as an input here
for the reason `VERCEL_ENV` is safe in `sentry.ts`: the platform injects it into the
runtime, so unlike `Host` no requester can influence it.

### 9.4 Secrets

Application configuration comes from Doppler → Vercel environment variables (§5); nothing
is set by hand in the Vercel dashboard, where it would be invisible to review and survive
no rotation.

Deployment credentials are CI's, not the application's, and live in GitHub Actions secrets:
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_STAGING_PROJECT_ID`, and the
two migration connection strings `STAGING_MIGRATION_DATABASE_URL` /
`PRODUCTION_MIGRATION_DATABASE_URL`. None appears in a workflow file; gitleaks already runs
in `ci.yml`.

One further input is required and is deliberately **not** a secret: the repository *variable*
**`PRODUCTION_HOST`** — production's public hostname, no scheme (e.g. `app.autobureau.com`).
It is a `vars.` entry rather than a `secrets.` one because a public hostname is not a
credential, and filing it as a secret would both misstate that and hide it from review.

It is read in exactly one place, and that place is why it matters: §9.7's rollback step
re-smokes production after promoting the previous deployment back. `vercel rollback` runs
before it and does not depend on the variable, so an unset `PRODUCTION_HOST` does not prevent
a rollback — it removes the **proof that the rollback landed**, which is the guarantee §9.7
actually makes. Because that step runs only under `if: failure()`, the job is already red, and
a verification that never ran is easy to misread as part of the original failure. The smoke
script therefore refuses a URL with no host and says so by name, rather than failing on an
unparseable URL.

**`SENTRY_DSN`** (ADR-014 D5, ADR-015; blueprint P1-19) is application configuration and so
comes from Doppler with everything else, per deployed environment. It is a write-only ingest
key rather than a credential, and it routes through Doppler anyway because a second handling
convention for one variable is how the first one drifts.

Unset is a supported state, not a misconfiguration: with no DSN the error-reporting sink is
never registered and logging is exactly what P0-01 shipped — structured JSON on
stdout/stderr. `local` and CI leave it unset, so no test depends on egress to a vendor.
The Sentry **environment** tag is derived from Vercel's injected `VERCEL_ENV`, the same way
preview deployments derive `APP_ORIGIN` from `VERCEL_URL` (§9.3); it is not a variable of
ours and does not appear in Doppler. Sourcemap upload stays off — for a server runtime that
would put readable source in a vendor's hands, which is a disclosure decision of its own.

Still outstanding, and **not** delivered by P1-19: the Sentry account and US-region project,
the signed DPA and data-category mapping, confirmation of the public subprocessor list, the
DSN's provisioning in Doppler, and doc 10 §4's "new-issue spike" alert rule. Until those
exist, error reporting is wired but not reaching anywhere.

### 9.5 Two connection strings, and why the running app only gets one

The application connects through Supabase's **transaction-mode pooler** (port 6543,
`?pgbouncer=true&connection_limit=1`). Vercel functions scale to many short-lived
instances, and `apps/web/src/server/db.ts` already assumes exactly this.

This is compatible with RLS by construction, not by luck: the tenant scope is set with
`set_config(..., is_local => true)` *inside* a transaction (`packages/db/src/scoped.ts`),
so it belongs to the transaction and cannot outlive it on a pooled connection. Session-level
scoping would leak across tenants here — which is why the code never used it.

Migrations use the **direct** connection (port 5432): `prisma migrate deploy` takes advisory
locks and issues DDL, and transaction-mode pooling breaks both. `DATABASE_ADMIN_URL` is
never set on the running application in any deployed environment; the runtime that serves
requests is not the job that migrates (doc 06 §5).

### 9.6 Migrations

`prisma migrate deploy` runs as a workflow step **before** the deployment that depends on
it, per §4's order (expand → services). It runs from CI, not from a developer's machine and
not from application startup — a migration that runs on boot runs once per cold start.

**Migrations are forward-only (§6). A code rollback is not a schema rollback**, and the
distinction is the whole point:

| What failed | What is reverted | How |
|---|---|---|
| Application code | the deployment | Vercel rollback — a pointer move between immutable builds; schema untouched |
| Configuration | the variable | change in Doppler, redeploy; no rebuild of the artifact |
| A migration | **nothing** | roll *forward* with a corrective migration |

This is why §6 requires every migration PR to state lock impact, table size at 100k
households, and a rollback story: the expand→contract discipline is what makes the previous
application version still run against the new schema. A migration that breaks the old code
has removed the ability to roll back at all, and that has to be a decision made in review
rather than discovered during an incident.

### 9.7 Rollback

A deployment has failed when `scripts/smoke-deployment.mjs` fails against it. The
production job runs it, and on failure promotes the previous deployment back automatically,
then re-smokes to prove the rollback landed.

Manually:

```bash
vercel rollback --yes                 # promote the previous production deployment
vercel ls --prod                      # previous revisions, newest first
node scripts/smoke-deployment.mjs https://<production-host>
```

Rollback is safe precisely because Vercel deployments are immutable and the schema is not
part of them. It is **not** safe, and must not be attempted, when the newer release shipped
a migration the older code cannot run against — that case is a forward fix.

### 9.8 Health and readiness

There is no `/health` endpoint, and none is needed: the smoke script asserts the properties
that actually matter, which a static health route cannot.

A deployment with no `AUTH_*` set serves the application shell and refuses every domain
request. The refusal is not uniform, and the split is deliberate:

| Request | Response | Why |
|---|---|---|
| `GET /` | **200** | The shell needs no authentication; the boundary is built lazily so missing configuration cannot take down the pages that never touch it |
| `GET /v1/households/current` | **401** | Protected path — middleware denies deny-by-default (ADR-009 D3) *before* the boundary is reached |
| `POST /v1/auth/sign-in` | **503** `"Authentication is not configured on this deployment."` | Public path, so it reaches the boundary, which reports itself unconfigured |

Both refusals are safe. The blueprint's shorthand — "503 on `/v1`" — describes the second
of these; making the protected route report 503 too would mean removing middleware's
deny-by-default, which is a weakening, so the smoke script asserts the architecture's actual
guarantee instead: no `/v1` route ever serves data unauthenticated, and the reachable
boundary reports its own misconfiguration rather than failing open.

### 9.9 What is NOT verified

**No live deployment has ever run.** There is no Vercel project, token, Supabase project,
or Doppler config available to this repository yet, and none was invented. Everything above
is configuration and procedure; the following remain unproved until a first real deploy:

1. **That Vercel accepts this monorepo build as configured.** `vercel.json` specifies the
   root-directory-at-repo-root form so the whole build is config-as-code rather than split
   between a file and a dashboard setting. The first deploy must confirm Vercel resolves
   `outputDirectory` for a Next.js app in `apps/web` this way; if it does not, the fix is
   the documented alternative (Vercel Root Directory `apps/web`, `vercel.json` moved
   alongside it) — a settings change, not an architecture change.
2. **That the Prisma query engine is traced into the serverless bundle.**
   `outputFileTracingRoot` is set to the workspace root for this reason; it is the standard
   pnpm-monorepo requirement, and it is unverified against a real function.
3. **That the pooled connection sustains the RLS transaction pattern under real
   concurrency.** The design is sound and the integration suite proves the isolation
   property against a real Postgres; what is untested is pooler behaviour under load.
4. **The rollback command against a real project.** The procedure is Vercel's documented
   one and the workflow invokes it, but no rollback has been executed.
5. **Cold-start latency, function duration, and cost** — every number in doc 14 §59 is an
   estimate until a deployment produces one.

The smoke script itself is verified: it passes 19/19 against a local production build with
`AUTH_*` unset, and fails when run against that same server without `--expect-unconfigured`,
so its assertions discriminate rather than merely pass.
