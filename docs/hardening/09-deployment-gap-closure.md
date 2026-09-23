# Deployment gap closure — what is actually deployed, and what blocks the rest

Second validation pass, over `ff580b4`. It corrects the deployment picture the previous
pass could not see, closes the onboarding honesty gap, and states precisely which
remaining blockers need a credential this environment does not hold.

## 1. The deployment picture, corrected

The previous pass reported the staging runtime as unknown and unreachable. That was true of
its environment but wrong about the world. GitHub Actions history settles it:

- **A Vercel deployment exists and serves correctly over HTTPS.** The `Deploy` workflow's
  preview job deploys and then smokes a real URL. On `2ebe11b` that smoke run scored
  **16/17**, with `GET /` at 200, all five constant security headers present, a per-request
  CSP nonce that differs between requests, every inline script carrying it, and
  `/v1/households/current` refusing an unauthenticated read with 401.
- **The `Deploy` workflow has never once succeeded** — five runs, five failures.
- **`main` has never run it.** Every run is `pull_request`, from the hardening branch.

So the constraint was never "the code does not deploy". It deploys, and the deployed thing
is substantially correct.

### The one failing check, and what it means

```
PASS  POST /v1/auth/sign-in never returns 200 for smoke credentials  {"status":503}
FAIL  configured boundary does not answer 503  {"status":503,
      "hint":"AUTH_* appears unset on this deployment"}
```

`scripts/smoke-deployment.mjs` branches on `--expect-unconfigured`. The preview job does not
pass it, so it asserts a *configured* boundary — and got 503, which `authConfigFromEnv`
returns only when an `AUTH_*` variable is missing. The assertion is correct and the
deployment is genuinely unconfigured: **the `AUTH_*` and `APP_ORIGIN` variables are not set
in the Vercel Preview environment.** Nothing in the repository can fix that; `vercel pull`
takes them from project settings.

This also explains the staging database. It holds 3 auth users, 1 mirrored user, and
**0 households, 0 memberships, 0 entitlements** — a boundary answering 503 cannot complete a
sign-in, so `ensureHousehold` has never run there.

### Preview credential isolation — checked, and correct

`deploy.yml` runs no migration in the preview job at all; staging and production each use
their own `*_MIGRATION_DATABASE_URL` secret, and previews pull only the preview environment.
A preview therefore cannot reach the production database. No change needed.

## 2. Onboarding — the decision, and what was done

**Persistence stays deferred (Option A).** It is P1-02's remaining half, PRD F3 is feature
work behind G1, and the blueprint's own definition of done for P1-02 — "new principal →
household created → membership resolves → dashboard reachable" — is met and verified.

**The claims about persistence were a defect, and are fixed (Option C).** Onboarding writes
nothing: `OnboardingProvider` is React state, no `app/v1` route accepts a census, and
`seedFromCensus` feeds one screen. Two surfaces said otherwise:

- The hand-over reported items "in your registry", deadlines being "hunted for", and
  "tracking for" the named members — durable state, present tense, gone on reload. It was
  already careful on the *other* axis (no dates, everything labelled unverified), which is
  exactly what made the durability claim easy to miss.
- The document step is **P0-07 on its last surface**. `671f0e7` disabled the two `(app)`
  dropzones and recorded that this one "has the identical defect (same toast, same discarded
  argument)" but was out of scope. Every file it accepted was discarded behind a "N documents
  received" toast — during onboarding.

Both now match reality, and the genuinely permanent outcome (household + session) is stated
plainly rather than buried among things that are not. Fixed in `19bb17f`.

## 3. Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 6/6 clean |
| `pnpm lint` | clean |
| `pnpm test` | **933** passing (web 831 · contracts 78 · db 16 · ops 8) |
| `pnpm test:integration` | **314** passing (web 266 · db 48) under real RLS |
| `pnpm build` | clean, 11/11 static pages |

Web unit tests rose 819 → 831: the P0-07 assertions the blueprint asks for ("assert the
dropzone does not report success without a request") plus the hand-over's claim tests.

### One flake, reported as a flake

`rate-limit.integration.test.ts` › `L3 the sweep is bounded` failed twice at the start of
this session (`expected 1 to be greater than or equal to 51`), then passed **13 consecutive
runs** — including three with deliberately seeded table residue, which was the leading
hypothesis. It is not a product defect: the bounded sweep was verified directly against
Postgres, where 150 expired rows minus one sweep leaves exactly 50, so `LIMIT 100` holds.
The test was left alone rather than rewritten speculatively — it is a security assertion and
it currently passes; weakening it to chase an unreproduced failure would cost more than it
buys. Worth watching in CI.

## 4. Security findings, with evidence

| # | Sev | Finding |
|---|---|---|
| 1 | **BLOCKER (production)** | Production Supabase remains unprovisioned — untouched this pass, by instruction. |
| 2 | **BLOCKER (staging)** | `AUTH_*` / `APP_ORIGIN` unset in the Vercel Preview environment; the boundary answers 503 and no sign-in can complete. Needs a Vercel credential. |
| 3 | **HIGH** | The `Deploy` workflow has never succeeded, so no deployment has ever been validated end to end. Downstream of #2. |
| 4 | **MEDIUM** | `main` is 55 commits behind and carries none of this work — a clean fast-forward, but a 55-commit default-branch move that belongs to a human. PR #3 is open for exactly this. |
| 5 | **LOW** (was MEDIUM) | `APP_ORIGIN` per-environment. `.env.example` §94 prescribes deriving it from `VERCEL_URL` for previews; no code does, and none should — production must keep its literal custom domain. Set `APP_ORIGIN=https://$VERCEL_URL` for Preview only, in Vercel. |
| 6 | **LOW** | Supabase advisor `function_search_path_mutable` on `app.current_household` / `app.current_user_id`. **Not exploitable**: both are `SECURITY INVOKER` (0 `SECURITY DEFINER` functions in `app`), and `app_user` holds `CREATE` on neither `public`, nor `app`, nor the database, so it cannot plant a shadowing function. Pinning `SET search_path` touches the two functions gating every RLS policy; the change is riskier than the finding. Recommended, not done. |
| 7 | **LOW** | Leaked-password protection disabled. Worth more than it appears: `password.ts` documents "zxcvbn ≥ 3 plus a haveibeenpwned k-anonymity lookup (doc 06 §1)" as the intended control and implements neither — the provider toggle delivers the breach half for free. A dashboard setting, not code. |
| 8 | **NON-BLOCKING** | `vector` in `public` — installed by the repo's own init migration, with **237 dependent objects**. Relocating it means dropping and recreating the extension and everything that depends on it, for a namespace-hygiene warning with no privilege impact (`app_user` cannot create objects in `public` either). Leave it. |

## 5. Not verified, and exactly why

- **The EC2 staging host.** No SSH client and no keys are present, and the AWS credentials in
  the environment are 14-character `prox`-prefixed placeholders, not AWS keys — `sts
  get-caller-identity` returns `InvalidClientTokenId`. The AWS API itself is reachable, so
  this is a credential gap, not a network one. Note also that doc 09 puts the web app on
  Vercel at `app.autobureau.com`; the EC2 box is not the architected target for it.
- **Live HTTP against the deployment.** The egress proxy denies `*.vercel.app` and
  `*.supabase.co` alike. The 16/17 smoke result above is from a GitHub runner, which can
  reach it — that is the right place to run acceptance tests, once #2 is fixed.
- **Vercel project settings.** No `VERCEL_TOKEN` in this environment, so the effective
  per-environment variables were inferred from the deployment's own 503 rather than read.
