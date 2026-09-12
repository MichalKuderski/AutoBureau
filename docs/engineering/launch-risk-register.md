# Pellum staging release-candidate risk register

Updated September 12, 2026. Scope: `codex/launch-foundations`, draft PR #5. This is a working register, not a release approval.

| Risk | State | Evidence / required closure |
| --- | --- | --- |
| Confirmation-email regression | PASS, regression gate retained | PR #4 merged separately as `3695e6c`. Real confirmation and consumed-link replay evidence retained in the release artifacts. |
| Concurrent Prisma generation breaks clean CI | PASS | `dbc42d0` makes the uncached DB build own generation. GitHub CI run 34701304063 passes. |
| Provider intermittently refuses duplicate signup | FAIL, staging blocker | Preview runs 34700604009 and 34701304066 each pass 56/57. Vercel records an HTTP provider refusal. Exact upstream cause unresolved; do not weaken the enumeration-safety check. |
| Placeholder household data and mutations | FAIL, implementation in progress | Registry queries still import fixtures; several settings/actions are local only or disabled. Every production path must use scoped persistence and honest empty/error states. |
| Document ingestion, review and reminders | FAIL, implementation required | Secure storage, scanning, extraction, provenance, dispatch and reminder lifecycles require end-to-end evidence. |
| Recovery, MFA and privacy workflows | FAIL, implementation required | Disabled recovery/security/export/deletion controls are disclosed but do not satisfy launch acceptance. |
| Stripe lifecycle | IMPLEMENTATION IN PROGRESS | Stripe CLI is now authorized only for Pellum sandbox (`acct_1UEsCbH8x2dVKqIp`). Read-only lists show no products or webhooks yet. Server deployment credentials and lifecycle evidence still required. No live charges authorized. |
| Plaid | DEFERRED NON-BLOCKER | Approved launch direction defers bank ingestion; no Production access or readiness claim. |
| Legal operator, contacts and clearance | EXTERNAL BLOCKER | Business identity, jurisdiction, public support/privacy contact and counsel approval unresolved. `usepellum.com` selected, not registered. Name/domain screening is not trademark clearance. |
| Exhaustive UI QA | FAIL, incomplete | Earlier 44 public HTTP probes passed; static inventory lists 153 controls across 22 routes. This does not prove authenticated, populated, failure, mobile or provider flows. |
| Stable staging final candidate | FAIL, not deployed | Current automatic deploys are Preview only. Stable staging acceptance and exact-SHA release evidence required after implementation. |
| Production readiness gates | NO-GO | No launch-branch merge, Production mutation, live billing, domain purchase/DNS or public launch authorized. External release prerequisites remain applicable. |

## Environment baseline

Read-only staging inspection before further work: 75 households / 75 entitlements, 7 completed migrations / 0 rolled back, 15 forced-RLS tables / 20 policies, no `ensure_rls` trigger. The 75 includes three synthetic accounts from Preview run 34700604009; later acceptance runs add separately counted fixtures. The controlled confirmation identity remains intact. No Production access was performed.

## Release evidence rules

- Record endpoint semantics and failures, not just aggregate green jobs.
- Run tenant-isolation assertions through `app_user`; admin connections only seed/inspect disposable test fixtures.
- Re-run affected integration and end-to-end journeys after fixes and before the next external checkpoint.
- Record provider blockers separately from missing implementation. A provider blocker does not excuse independent product work.
- Replace each failing row only with linked evidence from the candidate SHA and the actual environment tested.

## Persisted settings increment

`GET/PATCH /v1/me` and owner-only `PATCH /v1/households/{id}` now persist through the authenticated boundary. Profiles are keyed only by the verified principal; household paths must match validated scope. Body bytes are bounded, schemas are strict, unchanged patches do not write, and audit rows commit with changes. Timezone is correctly edited on the profile because the current model stores it there. UI success waits for the server and preserves failed edits.

Local evidence: lint/typecheck passed, 26 settings UI tests passed, 12 new real-database route checks passed, and 167 affected HTTP/policy unit checks passed. All 294 web integration checks passed on disposable local PostgreSQL 18; CI retains PostgreSQL 16. No schema or hosted-database mutation is part of this increment.
