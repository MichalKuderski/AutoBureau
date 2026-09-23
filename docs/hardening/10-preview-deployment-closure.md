# Preview deployment closure — what was fixed, and what needs a credential

Third deployment pass, over `ec6fb6f`. It closes the one deployment blocker that lived in
the repository, and states exactly which of the remaining ones do not.

## 1. The deployment is real, and its failure is one variable

Re-run of the `Deploy` workflow on PR #3 at `2ebe11b`, 2026-09-04 00:22 UTC:

```
16/17 checks passed against https://autobureau-production-mtj98y8xv-…vercel.app
PASS  GET / responds 200
PASS  x-content-type-options · referrer-policy · x-frame-options ·
      strict-transport-security · permissions-policy
PASS  script-src carries a per-request nonce   PASS  the nonce differs between two requests
PASS  every inline script carries the response nonce   {"inlineScripts":15}
PASS  GET /v1/households/current never serves data unauthenticated  {"status":401}
FAIL  configured boundary does not answer 503  {"status":503,
      "hint":"AUTH_* appears unset on this deployment"}
```

The build, the deploy, HTTPS, the headers, the nonce and the unauthenticated denial are all
correct. `authConfigFromEnv` returns 503 only when an `AUTH_*` variable is missing, so the
single failure is configuration: **the `AUTH_*` values are not set in the Vercel Preview
environment.** The staging database agrees — 3 auth users, 1 mirrored user, and still
0 households, because a boundary answering 503 completes no sign-in and `ensureHousehold`
never runs.

`staging` and `production` jobs were correctly **skipped** on that run. Production was not
touched.

## 2. What was actually fixed: `APP_ORIGIN` on previews

Doc 09 §9.3 and `.env.example` §94 both required preview to "derive it from Vercel's
`VERCEL_URL` rather than pin a literal". **That instruction could not be obeyed by anyone.**
A Vercel environment variable is a literal string — `$VERCEL_URL` in its value is not
interpolated — so one stored value cannot follow the different host every preview gets. The
requirement was addressed to a layer incapable of carrying it out, which is why no
configuration ever satisfied it.

The cost is not cosmetic. `APP_ORIGIN` is what the CSRF check compares `Origin` against, so
a preview holding any literal rejects its own form posts: sign-in, sign-up and magic-link
all answer 403 on the very deployment meant to prove they work.

So the derivation now happens in `authConfigFromEnv` (`475516e`), which is the only place
that sees both variables at request time. `sentry.ts` already read `VERCEL_ENV` on the same
premise and its comment names this case as the precedent.

**Why `VERCEL_URL` is not the `Host` header mistake:** the platform injects it into the
runtime, fixed for the life of the deployment. It arrives with the process, not with the
request, so no caller can influence it.

Two guards keep it narrow, and both are tested:

- An explicit `APP_ORIGIN` always wins, so staging and production keep the domain they are
  actually served on.
- The fallback requires `VERCEL_ENV` to be exactly `preview`. A production deployment that
  loses `APP_ORIGIN` fails closed at 503 rather than accepting its own `*.vercel.app`
  deployment URL and then rejecting every post from the real domain.

### Verified at HTTP level, against the real production build

Not asserted — executed, with `next start` on the production build and `APP_ORIGIN` unset:

| Environment | `POST /v1/auth/sign-in` | Meaning |
|---|---|---|
| `VERCEL_ENV=preview` + `VERCEL_URL` | **401** | boundary is configured — this is the smoke assertion that fails today |
| `VERCEL_ENV=production` + `VERCEL_URL` | **503** | refuses to trust its own deployment URL |

CSRF was re-checked in the preview case and is unweakened: foreign origin → 403, missing
`x-autobureau-request` header → 403, unauthenticated `/v1` → 401.

**This does not by itself turn the preview green.** It removes `APP_ORIGIN` from the
operator's list and makes it correct-by-construction; the other six `AUTH_*` values are
still unset and still need configuring.

### Confirmed by deploying it (run #6, `e200c79`)

Worth stating because a plausible reading said otherwise. The 503 is raised when **any** of
the seven values is missing, and the smoke suite's `"AUTH_* appears unset"` is the script's
own hint rather than a reading of the deployment — so `APP_ORIGIN`, the one value that could
not be a literal, was a credible sole cause.

It was not. PR #3 was fast-forwarded to `e200c79` and the pipeline redeployed against it:

```
16/17 checks passed against https://autobureau-production-1tdp9rcck-…vercel.app
FAIL  configured boundary does not answer 503  {"status":503}
```

Same score, same failure, with the derivation in place. The other six values are therefore
genuinely absent, and no repository change can supply them. CI on the same commit is green —
lint · build · typecheck · test, governance documents, and architectural guardrails all pass
— so the preview smoke is the only red check on the PR.

## 3. What needs a credential this environment does not hold

**Setting them in the Vercel dashboard would be wrong**, not merely unavailable. Doc 09
§9.4: "Application configuration comes from Doppler → Vercel environment variables (§5);
nothing is set by hand in the Vercel dashboard, where it would be invisible to review and
survive no rotation." The Preview config belongs in **Doppler**, which syncs to Vercel.

Required in Doppler's preview config, all pointing at **staging**:

| Variable | Value |
|---|---|
| `AUTH_ISSUER` | `https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1` |
| `AUTH_AUDIENCE` | `authenticated` |
| `AUTH_JWKS_URL` | `https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1/.well-known/jwks.json` |
| `AUTH_API_URL` | `https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1` |
| `AUTH_ANON_KEY` | staging publishable (anon) key — not a secret, but per-environment |
| `AUTH_COOKIE_NAME` | `ab_session` |
| `DATABASE_URL` | staging **`app_user`** via the transaction pooler (port 6543). Never the `postgres` admin role, never production |
| `APP_ORIGIN` | **leave unset** — see §2 |

This environment has no Vercel CLI, no `VERCEL_TOKEN`, no Doppler token, and the egress
proxy denies `api.vercel.com` and `*.vercel.app`, so none of it could be applied here.

## 4. One thing to check while configuring

Preview deploys resolve to `autobureau-production-…vercel.app`, which means
`VERCEL_PROJECT_ID` names the **production** Vercel project and previews live in that
project's Preview scope. That is a legitimate Vercel layout, and nothing leaks today because
the scope is empty. But it puts preview configuration one scope-selection mistake away from
production credentials, so each value above wants confirming as **Preview**-scoped when it
is set.

## 5. Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 6/6 clean |
| `pnpm lint` | clean |
| `pnpm test` | **950** passing (web 848 · contracts 78 · db 16 · ops 8) |
| `pnpm test:integration` | 314 (48 db · 266 web) — see the flake below |
| `pnpm build` | clean, 11/11 static pages |
| client bundle | no secrets, no JWT-shaped strings |

Unit tests rose 933 → 950: 17 new cases fencing the `APP_ORIGIN` derivation, most of them
negative — production, development, unknown `VERCEL_ENV`, off-Vercel, and blank values.

### The `L3` flake, now root-caused and deliberately left alone

`rate-limit.integration.test.ts` › `L3 the sweep is bounded` fails roughly 1 run in 3 of the
**full** suite, and never when its file runs alone. A statement-level `DELETE` audit over a
failing run shows the mechanism: the seeded rows are removed by **more than one** sweep
between the request and the count — 100 then 51, 5ms apart — and on other runs the entire
seed disappears before the request is even made. The test's assertion assumes exactly one
sweep occurs in that window; that assumption is timing, not the invariant.

**The invariant itself holds and was verified directly**: against Postgres, 150 expired rows
minus one sweep leaves exactly 50, so `LIMIT 100` is enforced. Every individual sweep in the
audit removed ≤100.

An attempt to harden it by seeding 1000 rows instead of 150 was made and **reverted** — it
did not fix the failure, because the dominant mode wipes the seed wholesale rather than
sweeping it, so a larger seed changes nothing. Rewriting a passing security assertion on a
second guess would have been worse than leaving it. It needs isolating from cross-test
cleanup, which is a focused task rather than a line change.

## 6. Promotion path

`main` has **`ci.yml` only — `deploy.yml` is not on it.** Three consequences, all load-bearing:

- `workflow_dispatch` cannot be used at all, because GitHub only offers it for workflows
  present on the default branch. The production job is unreachable today.
- The `staging` job (`on: push` to `main`) has never run.
- Every one of the five `Deploy` runs was `pull_request`, from PR #3.

So merging PR #3 is not only how the code ships — it is what makes the deployment pipeline
usable at all.

PR #3 (`claude/autobureau-hardening-audit-1tb0gh` → `main`, head `2ebe11b`) does **not**
contain the onboarding honesty fix, the two validation reports, or the `APP_ORIGIN` fix. The
branch carrying those is a clean fast-forward of PR #3's head, 0 commits behind, so bringing
them in updates PR #3 in place rather than opening a second one.
