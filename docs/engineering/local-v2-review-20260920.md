# Pellum v2 native review and continuation — September 20, 2026

**Local development increment verified. Production preflight remains NO-GO.**
Tested implementation: `22756b6eb9be24f60f9e7710fd24906adb525cb5` on
`codex/review-pellum-hardening-v2`. A subsequent documentation-only commit records
this receipt; it does not change the tested application, tests, lockfile or CI.

## Reconciliation and preservation

The original checkout is still `main` at
`56cf76ed3f6da70b506a1dd34b7258bfe6eebd95`. Its modified `CLAUDE.md` and untracked
user work were not overwritten, staged, stashed, reset or discarded. All 386 files
in the initial tracked/untracked hash inventory remain unchanged.

The package's base was absent locally. Read-only HTTPS inspection established that
PR #5 remains open/draft/unmerged and its head remains
`7863ec89e1cfd35abb3dcd0132ba2ae1c42c6595`. Fetching that branch recovered history;
Git proves the original local main is an ancestor. The latest launch PRD amendment,
ADRs and risk checkpoint were read before implementation. No branch was reset.

Work is isolated in `/private/tmp/pellum-native-review-20260920`. The archive was
checked for unsafe paths/symlinks before extraction. Both patch hashes, all three
baseline hashes and all 18 proposed-file hashes matched. The cumulative v2 patch
passed `git apply --check`, was applied once, and all 18 outputs matched again.
The v1 delta was not applied. The helper was inspected but its exact-branch apply
mode was deliberately not used to change the original checkout. Its nine safety
tests pass separately.

Local commits:
- `23d34ed`: auth/Plaid transport and response hardening, provisional Stripe TEST
  policy/notice foundations, plus real-route/DB regressions and Buffer-copy fix.
- `0fb6e7d`: exact development-only Stripe SDK and offline cryptographic fixtures.
- `22756b6`: fail-closed staging SNS subscription evidence guard and CI tests.

No push, PR edit, merge, workflow dispatch, deployment or provider configuration
mutation occurred. PR #4's historical confirmation fix remains intact. PR #5's
remote head and CI do not contain these new local commits.

## What changed and why

Auth no longer invents a confirmation outcome from malformed or unreadable HTTP
success bodies. It projects only complete session tokens with safe positive
integer lifetime, or a UUID-bearing pending user with no partial token fields.
Actual UTF-8 response bytes, chunks and the shared header/body deadline are bounded.
Credential-bearing redirects and automatic credential retries remain prohibited.
Plaid retains fixed Sandbox scope, owner binding and Zod response validation while
using the same bounded reader and a closed four-route transport.

The new route/provider/PostgreSQL cases prove malformed JSON, truncated JSON,
oversized bodies and partial token sets return coarse 503/no cookies, make one
provider attempt and create no identity/profile/membership/household/bootstrap
audit rows. Explicit retry converges to one profile, household, owner membership,
entitlement and five-row audit sequence. Existing confirmation, refresh, duplicate,
anti-enumeration and tenant checks remain intact.

The first expanded integration run correctly hit 429 because the added tests
reused one address and exhausted its three-attempt bucket. The fixture now uses a
distinct synthetic identifier per case; no policy or assertion was weakened. All
four new cases also fail against the actual historical provider with **202 instead
of 503**, demonstrating that they detect the original defect. The reviewed provider
was restored byte-for-byte afterward.

Review found that `Buffer.slice()` contradicts the Stripe adapter's promised byte
copy. `new Uint8Array(rawBody)` now creates independent storage, protected by a
regression. [Official SDK conformance](stripe-sdk-conformance-20260920.md) adds
real cryptographic checks without any provider request. It does not activate billing.
[The SNS evidence guard](staging-alert-evidence-20260920.md) refuses Deleted,
pending, duplicate and incomplete snapshots; it never claims mailbox delivery.

## Actual verification

Node **22.16.0**, pnpm **10.34.5**, lockfile TypeScript **5.9.3**, Vitest **3.2.7**,
Next **15.5.22**, Prisma **6.19.3**. The package's isolated TypeScript 5.8.3 result
was not substituted for repository typechecking. Existing dependency resolutions
were preserved; only development-only `stripe@22.6.2` was added and integrity-pinned.
No Stripe SDK reference appears in the 57 generated deployment trace files.

| Check | Result |
| --- | --- |
| Frozen lockfile install | PASS, before and after the reviewed SDK addition |
| Required package native tests | 308/308 initially; later full suite includes all changes |
| Full unit/regression suite | **1,370/1,370**: web 1,247, contracts 99, DB 16, ops 8 |
| Full PostgreSQL/RLS integration | **447/447**: DB 70, web 377 |
| Full lint | PASS: zero errors, 13 existing console warnings in scripts |
| Full build and typecheck | PASS |
| Official Stripe SDK synthetic signature fixtures | 16/16, included in unit total |
| Local infrastructure/acceptance controls | 153/153 (132 existing plus 21 SNS guards) |
| Architecture shell checks from CI | 7/7 |
| Package helper safety fixtures | 9/9 |
| Historical-provider negative control | All four new route cases detect the defect |
| Final diff whitespace check | PASS |

Integration ran against a new disposable **PostgreSQL 18.3 + pgvector** cluster,
`127.0.0.1:55539/pellum_v2_review`, not an existing container or a hosted URL. Docker
was unresponsive, so the installed Postgres.app binary was used. Both harnesses
explicitly expected major 18 via `DATABASE_EXPECTED_MAJOR=18`; Turbo's loose mode
was used only with a sanitized environment containing local synthetic DB targets.
CI still pins PostgreSQL 16; this run is not version-16 evidence.

Local read-back: 13 completed migrations, zero rolled back, 21 forced-RLS tables,
27 policies, no ensure_rls trigger. `app_user` is not superuser, has no BYPASSRLS,
and owns zero tables. These are **local database counts**, not current staging
invariants. Restricted-role isolation and worker authorization were exercised.
The task-owned cluster is stopped after verification; no real data was used.

The [machine-readable receipt](evidence/local-v2-native-20260920.json) records
scope, toolchain, failure/fix, immutable source, counts and log hashes. Logs and
reproduction wrapper are under `/private/tmp/pellum-v2-review-20260920/`.

## Gates and next work

**Subsequent update:** dashboard access was restored and the bounded [September 20 diagnostic follow-up](supabase-diagnostic-followup-20260920.md) completed. The access blocker described below is historical; deeper provider causality and complete historical credential invalidation remain unresolved.

The next provider diagnosis action is blocked by an actual access check: opening
the exact staging Supabase dashboard redirected to sign-in. The user has been asked
to restore that session personally; the tab remains open. Do not repeat the earlier
OAuth revocation blindly. The user reported revocation and fresh authorization;
that report is retained, but this increment does not establish historical token
invalidation or close credential containment. Never reproduce old callback values.

1. After session restoration, verify containment with bounded provider/account
   evidence and inspect staging-only Auth/gateway/DB diagnostics. Keep the September
   13 upstream 504 unresolved until evidence supports a cause/recovery conclusion.
   Synthetic 503 handling and a green rerun do not prove hosted reliability. Current
   public changelog confirms the September 23 logs.all removal; use the ClickHouse
   logs endpoint. Prepare a sanitized support packet if needed, but do not send it
   without authorization.
2. Freshly verify SNS real-ARN/attributes/counters with the new guard, then actual
   approved-recipient delivery and effective encryption/policies. No current live
   SNS state or successful receipt is claimed here. ADR-017 live apply/probes remain
   behind their previously approved exact safety/cost gates; no activation in this
   local increment.
3. Continue independent local scanner/dispatcher/retention/reconciliation, safe
   redaction, document review/delivery and reminder work under their governing ADRs.
   Those remain implementation gaps, not all external blockers. Real intake,
   continuous processing and real sensitive document/model transfers remain OFF.
4. Complete recovery/MFA/export/deletion and provider erasure; durable Stripe TEST
   inbox/ownership/refetch/outbox/entitlements/lifecycle; Plaid encrypted token custody,
   persistence, sync, reconnect/unlink/privacy and Sandbox lifecycle. SDK signature
   fixtures and transport units do not establish those workflows.
5. Run exhaustive route/control/UI/accessibility QA and exact-SHA hosted acceptance
   only at the relevant release gate. None ran here. Keep PR #5 draft until blocking
   work is complete; pushing a PR branch triggers Preview, so inspect workflow and
   schema consequences before any remote update.

US/English, one account holder managing household members, provisional $12/month
or $99/year Premium remain unchanged. Stripe TEST and Plaid Sandbox/Development
only. Legal operator/jurisdiction/contacts and domain/legal/provider prerequisites
remain unresolved. Production mutation/deployment, Live charging, real financial
accounts, real sensitive document/model processing, DNS and public launch require
separate explicit authorization. No full-stack, full-browser or launch-ready claim.
