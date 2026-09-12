# Pellum staging release-candidate risk register

Updated September 12, 2026. Scope: `codex/launch-foundations`, draft PR #5. This is a working register, not a release approval.

| Risk | State | Evidence / required closure |
| --- | --- | --- |
| Confirmation-email regression | PASS, regression gate retained | PR #4 merged separately as `3695e6c`. Real confirmation and consumed-link replay evidence retained in the release artifacts. |
| Concurrent Prisma generation breaks clean CI | PASS | `dbc42d0` makes the uncached DB build own generation. GitHub CI run 34701304063 passes. |
| Provider intermittently refuses duplicate signup | FAIL, staging blocker | Preview runs 34700604009 and 34701304066 each pass 56/57. Vercel records an HTTP provider refusal. Exact upstream cause unresolved; do not weaken the enumeration-safety check. Later Preview 34703871178 passes 57/57; one successful run does not close the intermittent failure. The next failure emits only a safe numeric upstream status and opaque trace. |
| Placeholder household data and mutations | FAIL, implementation in progress | Dashboard, item/document/obligation reads and status changes now use the tenant API locally. Household/profile/member changes persist. Notifications still use fixtures; manual item creation, onboarding and other actions remain incomplete. Every production path must use scoped persistence and honest empty/error states. |
| Document ingestion, review and reminders | FAIL, implementation required | Secure storage, scanning, extraction, provenance, dispatch and reminder lifecycles require end-to-end evidence. |
| Recovery, MFA and privacy workflows | FAIL, implementation required | Disabled recovery/security/export/deletion controls are disclosed but do not satisfy launch acceptance. |
| Stripe lifecycle | IMPLEMENTATION IN PROGRESS | Stripe CLI is now authorized only for Pellum sandbox (`acct_1UEsCbH8x2dVKqIp`). Read-only lists show no products or webhooks yet. Server deployment credentials and lifecycle evidence still required. No live charges authorized. |
| Plaid | DEFERRED NON-BLOCKER | Approved launch direction defers bank ingestion; no Production access or readiness claim. |
| Legal operator, contacts and clearance | EXTERNAL BLOCKER | Business identity, jurisdiction, public support/privacy contact and counsel approval unresolved. `usepellum.com` selected, not registered. Name/domain screening is not trademark clearance. |
| Exhaustive UI QA | FAIL, incomplete | Earlier 44 public HTTP probes passed. Local browser checks now cover scoped empty/populated records, settings, member lifecycle/capacity, obligation lifecycle, search and navigation, plus 390/320 px layouts. Static inventory is not exhaustive evidence; provider/document/privacy flows and final exact-SHA staging QA remain incomplete. |
| Stable staging final candidate | FAIL, not deployed | Current automatic deploys are Preview only. Stable staging acceptance and exact-SHA release evidence required after implementation. |
| Production readiness gates | NO-GO | No launch-branch merge, Production mutation, live billing, domain purchase/DNS or public launch authorized. External release prerequisites remain applicable. |

## Environment baseline

Latest read-only staging inspection: 84 households / 84 entitlements, 7 completed migrations / 0 rolled back, 15 forced-RLS tables / 20 policies, no `ensure_rls` trigger. The earlier 72 baseline gained three synthetic accounts in each of Preview runs 34700604009, 34701304066 and 34703871178, then three more in Preview 34705786030. No controlled-account cleanup occurred. App roles retain their prior login/BYPASSRLS flags and own zero public tables. The controlled confirmation identity remains intact. No Production access was performed.

## Release evidence rules

- Record endpoint semantics and failures, not just aggregate green jobs.
- Run tenant-isolation assertions through `app_user`; admin connections only seed/inspect disposable test fixtures.
- Re-run affected integration and end-to-end journeys after fixes and before the next external checkpoint.
- Record provider blockers separately from missing implementation. A provider blocker does not excuse independent product work.
- Replace each failing row only with linked evidence from the candidate SHA and the actual environment tested.

## Persisted settings increment

`GET/PATCH /v1/me` and owner-only `PATCH /v1/households/{id}` now persist through the authenticated boundary. Profiles are keyed only by the verified principal; household paths must match validated scope. Body bytes are bounded, schemas are strict, unchanged patches do not write, and audit rows commit with changes. Timezone is correctly edited on the profile because the current model stores it there. UI success waits for the server and preserves failed edits.

Local evidence: lint/typecheck passed, 26 settings UI tests passed, 12 new real-database route checks passed, and 167 affected HTTP/policy unit checks passed. All 294 web integration checks passed on disposable local PostgreSQL 18; CI retains PostgreSQL 16. No schema or hosted-database mutation is part of this increment.

## Registry, people and obligation increment

`d09ac057f0cbd198a9de0d2a02a0c66b7f85d138` adds scoped list/detail APIs and owner-only member management. CI 34703871170 passes; Preview 34703871178 passes smoke 17/17 and acceptance 57/57. The stable deployment and Production jobs were not run.

The next local increment replaces registry fixtures in the browser with bounded cursor queries, puts filters before pagination, and persists obligation status/outcome changes with cancellation of scheduled reminders and an outbox intent in the same transaction. Exact repeats create no additional lifecycle event; concurrent requests serialize per obligation. Reopening needs the future reminder materializer to schedule new reminders, so no delivery readiness is claimed. Review filing remains disabled until the validated processing pipeline exists.

Local evidence so far: 325 web integration checks pass through `app_user`; 66 affected UI/date checks pass. Browser checks confirm name/profile persistence across reloads, person create/edit/archive/cancel/restore and a real 402 capacity error preserving the form, obligation completion with a $120.50 outcome across reload, reopen/dismiss, keyboard item detail and server-backed search. A disposable local GoTrue-shaped issuer is used for these browser checks; they do not replace real Supabase acceptance. Mobile navigation/form dismissal restored focus at 390 px and 320 px, with no horizontal overflow. Local sign-out returns to sign-in. Rebuilt browser rechecks confirm the corrected upcoming panel, empty-person filter recovery and document-review URL filter. Calendar day detail and month navigation pass. Build, 986 unit checks and the final 24 affected database checks pass; the final copy/accessibility touch-ups receive targeted validation.

QA found and corrected misleading empty states (an action-needed deadline was excluded from “coming up”; an empty person filter described the whole registry as empty) and a completion dialog that closed before the server saved. No production fixture fallback is allowed for the API-backed screens. Notification fixture removal remains a release blocker.

## Activity history increment

`4242ebc126facb4697fe428f2d59796c5f4c1dd0` passes CI 34705786065 and Preview 34705786030, including smoke 17/17 and acceptance 57/57. The later activity increment adds `GET /v1/timeline` and removes its production fixture. It selects recognized audit action/target pairs, resolves current record labels through tenant scope, excludes audit metadata and unrelated supporting writes, and preserves PostgreSQL timestamp precision in pagination. Current labels are identified as current, not historical snapshots. No savings or delivery event is inferred.

Activity validation: build/lint/typecheck pass; 5 real-database checks and 12 UI checks pass. Browser QA in the rebuilt local application confirms four prior lifecycle entries, timezone-correct dates, the empty Documents filter, Deadlines filter and navigation to the saved obligation. No warning/error console entries were captured. No schema or hosted-data mutation was required.
