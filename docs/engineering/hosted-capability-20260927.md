# Hosted-capability run — September 27, 2026

**Decision: NO-GO.** Every row below is scoped to its evidence. Hosted Stripe TEST billing is
implemented, verified locally and schema-deployed to staging, but it is **not proven on staging**:
the remaining steps are provider writes and secrets that only the operator may perform.

## Staging state after this run

| Item | Evidence | Status |
| --- | --- | --- |
| Runtime on `autobureau-staging.vercel.app` | `deploy.yml` run #99 at `22f397d` (`preprod/pellum-22f397d`): smoke 17/17, acceptance 73/73 | deployed |
| Hosted MFA, recovery, authoritative password policy | run #97 at `1717113` and again in run #99's acceptance | PASS (API level) |
| Staging schema | run #98: 45 → 46 migrations; identity check: 46 rows, 0 unfinished, 0 rolled back, new checksum equals the candidate file (`d297aada…875b`); both new tables force RLS; 3 new policies | PASS |
| Hosted Stripe TEST checkout | billing runtime not configured on staging; run #99 acceptance recorded the checkout checks as skipped | NOT PROVEN |
| Deployment gate | exact-name `staging` branch rule added for runs #98–#99, then removed (`main` only again) | restored |
| `main` | `3695e6c`, untouched | — |

Supabase staging Auth: minimum password length 8 and the token-hash reset template (both set on
September 27, before/after recorded). The support ticket stays **OPEN — PROVIDER INVESTIGATION
PENDING**.

## Local exact-candidate evidence (`22f397d`)

- Full suite: ALL PASS (build, typecheck, lint, unit, controls, guards, DB/web/billing integration,
  posture readback, ClamAV proof). Two earlier attempts on the same tree were discarded: one when the
  host slept with the lid closed (931 s and 665 s), one when iCloud file-provider load made
  setup hooks exceed 120 s. Discarded runs are kept, not reinterpreted.
- Source mutations: **21/21 detected**. These include nine new billing controls: internal
  signature, operation-path binding, session identity, dedicated DB login, runtime beside web
  authority, Live key, web holding a Stripe credential, redirect following, and binding an open
  session.
- Database mutations (hosted checkout): **3/4 detected**. The three detected were owner-only
  intents, bound-requires-binding, and route enumeration. `billing-writes-checkouts` (a widened
  grant) was **not detected**, because an independent control, the billing audit publication
  guard, still refuses the write. A rolled-back probe showed `TEST audit refused`. The mutation
  therefore does not isolate a single control, and it is not counted as a detection.

## Stripe TEST design (ADR-020 hosted amendment)

- The web runtime holds **no Stripe credential and no Stripe SDK**. A guard pins that the web
  imports only the SDK-free signing subpath.
- A separate billing runtime (`apps/billing`, route handlers only) holds the TEST key, the webhook
  secret and the `app_billing_test` login. It refuses to start:
  - beside web authority;
  - with a Live-shaped key;
  - when `BILLING_TEST_DISABLED=1`.
- **Checkout:**
  1. The owner (recent authentication) writes an intent.
  2. The billing runtime creates the customer and session, with idempotency keys derived from the intent.
  3. The owner records the returned IDs.
  4. On return, the billing runtime re-reads the session and requires the exact recorded IDs.
  5. The owner binds the subscription and marks the intent bound in one transaction; a trigger derives the route digests.
  6. An internal `checkout-return` reconciliation sets the state.

  Premium comes only from reconciled state.
- **Webhook:**
  - raw-body verification with the official SDK;
  - five inbox event types, routed by customer digest;
  - durable dedupe;
  - 503 until settled, with at most three claims.
- **Missed webhooks:** a daily cron reconciles through per-subscription-per-day UUID intents. No
  `evt_` is ever fabricated.
- **Web → billing:** HMAC with a dedicated secret. The Vercel OIDC token is not forwarded, since
  that would expose the web project's AWS roles.

## Found and fixed in this run

- A signed internal request could be replayed against another operation's handler; the path must now
  name exactly the operation. Found by test before commit.
- The billing app bundled the Prisma client instead of tracing its Linux engine, so its first
  database call on Vercel would have failed.
- `export-archive`'s identifier canary matched inside the archive's own SHA-256 digests (a flaky false
  positive, not a leak). The canary is now non-hexadecimal.
- Key-shaped synthetic test strings were removed from history before the first push. The three
  unpublished commits were replayed; the final tree is byte-identical; gitleaks reports no findings.
- The pnpm store from an earlier session had been in `/tmp` and was gone. The tree was reinstalled
  frozen into the durable store (lockfile unchanged); the lockfile then gained only the two new
  workspace importers.

## Not done, and why

- **Stripe TEST objects, Vercel billing project, secrets, role password, GitHub billing settings:**
  the session's permission classifier refused the agent's Stripe writes. The operator checklist is
  kept with the evidence (`05-stripe-operator-steps.md`), together with the operator-run
  `hosted-billing.mjs`.
- **Plaid runtime, Plaid KMS, export S3/KMS, alert delivery:** the AWS console session is still the
  account root user, so no change was attempted.
- **Three-browser authenticated matrix on `22f397d`:** operator-run `hosted-auth.mjs`.
- **Hosted grace expiry:** needs seven real days of database time; Stripe test clocks move provider
  time only. It is verified locally against the database clock.
- **Screen reader:** no automation path; the gate stays explicit.
- **Backups:** production requirement only; staging's Free plan has none; no drill was fabricated.
