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
