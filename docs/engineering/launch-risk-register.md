# Pellum staging release-candidate risk register

Updated September 12, 2026. Scope: `codex/launch-foundations`, draft PR #5. This is a working register, not a release approval.

| Risk | State | Evidence / required closure |
| --- | --- | --- |
| Confirmation-email regression | PASS, regression gate retained | PR #4 merged separately as `3695e6c`. Real confirmation and consumed-link replay evidence retained in the release artifacts. |
| Concurrent Prisma generation breaks clean CI | PASS | `dbc42d0` makes the uncached DB build own generation. GitHub CI run 34701304063 passes. |
| Provider intermittently refuses duplicate signup | FAIL, staging blocker | Preview runs 34700604009 and 34701304066 each pass 56/57. Vercel records an HTTP provider refusal. Exact upstream cause unresolved; do not weaken the enumeration-safety check. Later Preview 34703871178 passes 57/57; one successful run does not close the intermittent failure. The next failure emits only a safe numeric upstream status and opaque trace. |
| Placeholder household data and mutations | FAIL, implementation in progress | Dashboard, item/document/obligation reads and status changes now use the tenant API locally. Household/profile/member changes persist. Onboarding now persists household members and unverified census records. Manual deadline creation/editing now persists with user provenance. Notifications still use fixtures; delivery and privacy actions remain incomplete. Every production path must use scoped persistence and honest empty/error states. |
| Document ingestion, review and reminders | FAIL, implementation required | Secure storage, scanning, extraction, provenance, dispatch and reminder lifecycles require end-to-end evidence. |
| Recovery, MFA and privacy workflows | FAIL, implementation required | Disabled recovery/security/export/deletion controls are disclosed but do not satisfy launch acceptance. |
| Stripe lifecycle | IMPLEMENTATION IN PROGRESS | Stripe CLI is now authorized only for Pellum sandbox (`acct_1UEsCbH8x2dVKqIp`). Read-only lists show no products or webhooks yet. Server deployment credentials and lifecycle evidence still required. No live charges authorized. |
| Plaid | DEFERRED NON-BLOCKER | Approved launch direction defers bank ingestion; no Production access or readiness claim. |
| Legal operator, contacts and clearance | EXTERNAL BLOCKER | Business identity, jurisdiction, public support/privacy contact and counsel approval unresolved. `usepellum.com` selected, not registered. Name/domain screening is not trademark clearance. |
| Exhaustive UI QA | FAIL, incomplete | Earlier 44 public HTTP probes passed. Local browser checks now cover scoped empty/populated records, settings, member lifecycle/capacity, obligation lifecycle, search and navigation, plus 390/320 px layouts. Static inventory is not exhaustive evidence; provider/document/privacy flows and final exact-SHA staging QA remain incomplete. |
| Stable staging final candidate | FAIL, not deployed | Current automatic deploys are Preview only. Stable staging acceptance and exact-SHA release evidence required after implementation. |
| Production readiness gates | NO-GO | No launch-branch merge, Production mutation, live billing, domain purchase/DNS or public launch authorized. External release prerequisites remain applicable. |

## Environment baseline

Latest read-only staging inspection: 90 households / 90 entitlements, 7 completed migrations / 0 rolled back, 15 forced-RLS tables / 20 policies, no `ensure_rls` trigger. The earlier 72 baseline gained three synthetic accounts in each of Preview runs 34700604009, 34701304066 and 34703871178, then three more in each of Preview runs 34705786030, 34706480951 and 34707361227. No controlled-account cleanup occurred. App roles retain their prior login/BYPASSRLS flags and own zero public tables. The controlled confirmation identity remains intact. No Production access was performed.

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

## Manual record increment

The activity commit `ca4fcbfa7755f4bd1011164841e45a01d90e94e8` passes CI 34706480990 and Preview 34706480951 (smoke 17/17, acceptance 57/57). Stable staging and Production jobs were skipped.

Manual `POST /v1/items` and `PATCH /v1/items/{id}` now save scoped records. Inputs exclude identifier storage and client-supplied authority/provenance fields. Member associations require an active person in the same household. Changed records clear their verification timestamp; exact repeats write nothing. Audit and minimal outbox intents commit with the record. The browser retains a failed form and uses the same idempotency key for retrying an unchanged creation request. Expiry is a calendar date, not a timezone-shifted instant. Item deletion/archive and a functioning reminder materializer remain separate incomplete flows.

Validation: build, lint and typecheck pass; all 336 web integration checks and 990 repository unit checks pass. A full integration run first exposed an admin-only test observation that counted unrelated households' idempotency rows. Scoping that observation to its request preserves the assertion and makes the full suite pass with populated QA households. Final form/focus/API checks pass 22/22.

Local browser QA creates and edits one record, verifies reload persistence, correct dates, amount and member, invalid-amount rejection, cancellation, keyboard row activation, a 390 px form without horizontal overflow and restored focus. Database read-back confirms one record, 12550 cents, one create + one update audit row and two outbox intents. The activity feed shows exactly those two actions. Captured warning/error console logs are empty. Native keyboard date input was used because the automation's fill-only action does not commit native date changes. No hosted database schema or configuration was changed.

## Persistent setup increment

The manual record commit `6ab0ff0f9f91c66b7503f6490ca52507b9ce6264` passes CI 34707361253 and Preview 34707361227, including 17/17 smoke and 57/57 acceptance. Stable staging and Production jobs were skipped. The intermittent auth refusal still needs causal closure.

Owner-only `GET/PATCH /v1/onboarding` resumes and saves real household setup. Existing profile JSON stores versioned state separately for each authorized household; principal and member locks prevent concurrent lost updates and capacity races. The server validates member associations and census IDs and creates only unverified records. It records each seed once, remembers removed records without resurrecting them, and never creates a dated obligation or reminder from a dateless answer. Complete/save retries create no extra records or events. Unknown stored versions fail visibly rather than silently resetting the user's answers.

The dashboard counts confirmation only among the selected census records. Unrelated verified records, archived records and foreign IDs do not inflate that metric. The copy explicitly limits the measure to the saved selections.

Validation: final build, lint and typecheck pass; repository units pass 987/987 (885 web). The initial full unit attempt was blocked by sandbox loopback restrictions on JWKS fixture servers; the unchanged tests pass with local-listener permission. Full web integration passes 344/344 before the coverage addition; all 24 affected onboarding/registry checks pass afterward, including the additional coverage boundary case. No schema migration or hosted configuration change was required.

Rebuilt local browser QA covers all four setup routes, saved answers after reload, repeated completion, truthful dateless claims and a 390 px handover. Read-back before/after repeat is identical: two census items, two item-create audits, two outbox intents, four total household items, two people, the one pre-existing obligation and zero reminders. The dashboard displays 0/2 confirmed. Captured console warning/error logs are empty. Document processing and notification delivery are still disclosed as incomplete; this increment is not a completed launch candidate.

## Manual deadline increment

The setup commit `5940c1a73b10e10d55b15461e2f998a9f446c478` passes CI 34708885098 and Preview 34708885092: 17/17 smoke and 57/57 acceptance. Production and stable-deploy jobs were skipped. That Preview creates the usual three synthetic households; the last direct database count of 90 predates it.

Manual `POST /v1/obligations` and detail `PATCH /v1/obligations/{id}` now persist through tenant scope. Lifecycle and detail patch shapes are mutually exclusive. The server owns source/verification fields and validates active member/record associations. Date changes cancel stale scheduled reminders and commit a minimal update event atomically. Exact repeats do not write; changing a completed record's details does not reopen it. User-confirmed edits retain the original related document but drop inherited AI confidence. Timeline includes the single domain edit row, not supporting writes.

The form uses the saved profile timezone. Nonexistent DST clocks are rejected; repeated clocks require an explicit occurrence. Editing another field preserves the exact saved instant, subsecond precision and currency. The detail screen now displays both date and local time. Temporal 0.5.1 is pinned; time-zone disambiguation follows the [TC39 documentation](https://tc39.es/proposal-temporal/docs/timezone.html). No host schema/configuration mutation is included.

Final validation: build, lint and typecheck pass; 353/353 web integration checks and 996/996 repository units pass (894 web). During an earlier run two asset-inspection tests raced an unfinished build; both pass in the complete suite after correcting build/test order. A strict optional-property typing mismatch was corrected before the successful final build.

Local browser QA creates one deadline, edits it to September 20 at 17:30 America/Denver, reloads, and verifies $125.50, its person and related record. Read-back confirms one row, one create + one detail-change audit, one created + one updated outbox event, and no reminders. Spring-gap rejection, fall-hour choice, direction/priority controls, mobile layout at 390 px and cancellation/focus restoration pass. Timeline shows the two intended changes; captured console warning/error logs are empty.

Remaining obligation work includes reminder materialization/delivery, snooze and recurrence lifecycles, and editing source-derived windows. Manual CRUD evidence does not establish those flows or complete the staging candidate.

## Notification schema foundation

The manual deadline commit `dc63a495732374e58359dadba67d2fc981a683a9` passes CI 34710349355 and Preview 34710349357, including 17/17 smoke and 57/57 acceptance. The prior setup Preview and this Preview add six expected synthetic households after the last direct count of 90; a fresh staging inventory is required before migration.

The next additive foundation creates notifications, channel deliveries and per-user preferences. Request-role policies enforce both recipient and household boundaries; only read timestamps and the user's own preferences are writable. The trusted dispatcher owns composition and delivery state. Security notices cannot be disabled. New notice/recipient and channel uniqueness prevent duplicate persistence. No delivery readiness is claimed.

Both migrations apply to disposable local PostgreSQL 18, and the final schema diff is empty. Full database integration passes 54/54, full web integration 353/353, and repository units 1,004/1,004. Build, lint and typecheck pass. The final six notification isolation checks also pass after adding the recipient index. An initial rerun used a nonexistent package config; correcting the test command changes no implementation.

[The staging migration plan](notification-migration-plan.md) requires a fresh legacy-state fingerprint, a target-checked migration-only job, read-back verification and immediate removal of the exact temporary branch allowance. Expected additive posture is 9 completed migrations, 18 forced-RLS tables and 24 policies; original role flags, owners, policies and rows must remain unchanged. Hosted migration has not yet occurred. Notifications UI still uses fixtures until the dependent API increment.
