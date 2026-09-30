# Document review client reliability slice

Local implementation on published base `13766613c0ddc55ffb5ad0438550c5cbcd2d8fc0`,
branch `fix/pellum-document-review-1376661`. This is independent of the unpushed
Plaid work. No push, deployment, provider activation, migration, or release approval.

## Behavior

- Reading/work queries display loading and transient errors with explicit retry.
  A 401 offers sign-in recovery; 403/404 conceal protected panels. Protected stale
  cache data is cleared after access denial. Owner role downgrade removes the
  result cache immediately, including inside the production freshness window.
- The source drawer distinguishes transient failure from unavailable content,
  suppresses stale titles and review content on error, and restores focus after retry.
- Each confirmed document decision captures its exact payload and idempotency key.
  Manual retries retain both; these actions do not inherit automatic mutation replay.
  A changed result or charging month requires a fresh confirmation.
- A response can be lost after commit. Every outcome is reconciled with an
  authoritative GET; stale pre-action claims are hidden while uncertain. Only a
  matching document/result terminal state or a known pre-write domain refusal plus
  a successful read releases the decision lock. Idempotency-in-flight conflicts
  remain uncertain. There is no processing/provider retry route.
- The lock is shared between result/work panels and survives component remounts
  inside the same QueryClient. Conflicting actions and duplicate clicks are fenced.
  Household/document changes abort the local request and suppress late UI/focus
  callbacks; potentially committed outcomes still invalidate the original household.
- Invalidation covers the actual documents, document detail, document quota, summary,
  obligations/detail, items/detail, timeline, and household query roots.
- Existing PRD 21.3 month/capacity/retention states, strict apply/discard `{resultId}`
  and cancel `{}` bodies, and all server auth/CSRF/RLS/capability boundaries remain
  unchanged. Upload and projected-field filing/correction gates remain disabled.

## Verification

Setup: authorized GitHub fetch matched the exact base. npm registry access and
frozen-lockfile install succeeded using Node 22.16.0 and pnpm 10.34.5. Effective
limits were 16 GiB memory and four CPU equivalents; test workers were capped at two.
No resource or network configuration was changed.

- Focused panel/drawer suite: 49 tests passed (36 added regression cases).
- Workspace lint: zero errors, 16 pre-existing console warnings.
- Workspace typecheck: 11 tasks passed after regenerating stale Next route types.
- Workspace build: 7 tasks passed; final web build passed. Final web unit suite:
  1,645 tests passed across 103 files.
- Other package unit suites: contracts 169, AI boundary 89, billing boundary 147,
  Plaid boundary 26, ops 8, billing app 1 passed.
- Database unit suite: 79 passed; 11 existing local-clean-custody tests failed
  because their hardcoded `/private/tmp` directory is absent on this Linux runner.
  No directory permission/resource workaround was applied.
- Database integration/tenant-isolation suite not run: no configured local database,
  no running Docker containers or cached database image. No infrastructure provisioned.
- Independent read-only review found and resolved role-cache exposure, late-write
  invalidation, retry focus, capacity-refusal recovery, and work-conflict copy issues.
- Chromium with the actual components and synthetic HTTP fixtures verified transient
  errors, retry focus, confirmation focus, committed-response-loss reconciliation to
  the focused filed status, source drawer rendering, and disabled filing control.
  This was a component fixture check, not authenticated full-application verification.
  Screenshots and command logs are in `/workspace/pellum-document-review-evidence`.

## Limits and follow-up

This is not a full release PASS. Real tenant-isolation integration checks and
full authenticated end-to-end verification still need the approved local services.
The decision lock is in QueryClient memory, not persistent across a full page reload
or separate browser tabs; server idempotency/domain serialization remain authoritative.
Known refusal recognition deliberately matches existing exact domain messages;
message changes fail closed to uncertainty and require corresponding client/tests
updates. No new response/correction contract was introduced in this slice.
