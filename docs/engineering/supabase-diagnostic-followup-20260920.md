# Staging Supabase diagnostic follow-up — September 20, 2026

**Upstream gateway 504 confirmed; deeper cause unresolved. Credential containment is
partially verified, not fully closed. No hosted mutation or rollout is authorized.**

Started from clean `codex/review-pellum-hardening-v2` at
`1ab22307629134ef4e5555ca6d723136d540137a`. Only staging project
`kdqnfruwgocfqwpbpuxo` was inspected. No password sign-in, signup, confirmation replay,
Auth configuration/user/session change, database write, provider-resource change,
deployment, merge, DNS change or external support submission was performed.

## Account evidence

Read-only GitHub account security-log searches freshly show:

- Supabase `oauth_authorization.destroy` at September 13 20:59 CDT
  (September 14 01:59 UTC).
- Five Supabase `oauth_access.destroy` entries at that same displayed minute.
- Replacement Supabase `oauth_authorization.create`, scope `user:email`, at
  September 13 21:04 CDT (September 14 02:04 UTC).
- Supabase account audit shows today's `Logged into account`, POST 201, at
  September 20 13:56:58 CDT (18:56:58 UTC), followed by staging management reads.

This corroborates the user's revocation/re-authorization and current authenticated
management access. It does **not** prove invalidation of every Supabase management
access/refresh credential issued before revocation. No old credential was retrieved,
reproduced or replayed to test it. GitHub grant revocation and Supabase management
session invalidation are distinct claims. Overall containment remains **STILL BLOCKED
for complete historical invalidation proof**; the GitHub OAuth replacement is verified.

This increment changed no application/provider secret. We did not fetch secret values
or compare all historical Doppler/Vercel/repository/database secrets, so a global
"no secret ever changed" claim is not established. Dashboard page loads themselves
record normal management reads/advisor diagnostics; no write setting was selected.
No raw audit detail, OAuth callback, token fragment, request body, arbitrary header,
IP address or personal identifier is included in this report or the support packet.

## ClickHouse evidence

Used the dashboard's `from logs` ClickHouse explorer, not deprecated `logs.all`.
The time control was verified as **2026-09-13 15:20:00–22:30:00 UTC**. The UI displayed
a retention/upgrade warning (Free: one day), but the completed projected queries
returned historical rows. The initial intermediate assessment that retention blocked
all access was corrected; the warning is not evidence that these logs are absent.
No upgrade, saved-query creation or retention change occurred.

| Gateway timestamp UTC | Gateway log ID | Provider request ID | Path | HTTP | `response.origin_time` raw |
| --- | --- | --- | --- | --- | --- |
| 15:25:06.508000 | `42aac198-23e9-4fb8-8954-7d266864ea96` | `01a09b5f-4286-7db1-9262-9c4232ad2668` | `/auth/v1/signup` | 504 | 5150 |
| 15:40:08.450000 | `786fcd07-4445-4422-b801-dbf75b480639` | `01a09b6d-05f9-73ec-8567-515c9d9a5b9f` | `/auth/v1/token` | 504 | 5154 |
| 22:25:08.490000 | `49a643b3-1fbe-44a4-8ac7-17f29c162775` | `01a09cdf-cf92-7e3b-a9cc-e59dfdd0a8fa` | `/auth/v1/token` | 504 | 5016 |

All three sources were independently projected as `edge_logs`. The two earlier
provider request IDs are newly recovered evidence. The raw origin-time field is
preserved without claiming independently verified units or a configured timeout.

Retained application evidence already records:

- Signup application 503 at 15:25:11.719Z, application trace
  `01a09b5f-3e1e-7c9e-9cac-69dc18be392b`, Preview run 34765409926.
- Sign-in application 503 at 15:40:13.659Z, application trace
  `01a09b6d-0014-70fa-bf63-5b86bbbc2a41`, Preview run 34766162197.
- Wrong-password application 503 at 22:25:13.540Z, trace
  `01a09cdf-cacb-7875-99cd-543f33318c3b`, Preview run 34786603902.
  Its provider request ID exactly matches the gateway, and the application measured
  **5,030 ms** for HTTP 504, before its **10,000 ms** deadline.

The first two correlations retain their timestamp/path evidence; newly recovered
provider IDs were not retroactively present in those application traces. These were
Preview executions against the **staging Supabase backend**, not stable-browser runs.
The separate stable 22:06 application 503 lacks retained upstream ID/status and
cannot be attributed to these gateway records. No new Vercel trace was invented.

### Auth and database correlation

- An explicit `count()` for `auth_logs` matching any of the three exact provider
  request IDs returned **0** in the verified 15:20–22:30 UTC window. `request_id`
  was verified in the actual Auth field-name inventory.
- Across the three narrow 30-second windows starting 15:25:00, 15:40:00 and
  22:25:00 UTC, aggregate results contain **43 Auth, 31 Auth-audit and 28 gateway
  rows**, with no database/pooler source rows in those exact windows. Thus nearby
  Auth logging exists, but no matching Auth completion establishes where the
  failed requests stalled. Absence of a matching log does not prove non-arrival.
- In 22:25:00–22:25:30, `/token` has six Auth HTTP-200 rows, with different request
  IDs. Those successes neither explain nor erase the failed request.
- In the wider 15:20–22:30 window, all **40 PostgreSQL rows have severity LOG** and
  all **94 Supavisor rows have level info**. Actual field names were discovered
  without reading query text or message bodies. Earlier empty severity projections
  used unprefixed fields; the corrected PostgreSQL keys are `parsed.error_severity`
  and `parsed.sql_state_code`. No absence-of-error claim relies on those empty fields.
- A wider two-minute neighborhood query returned 23 PostgreSQL/pooler records,
  but no request-linked latency/wait evidence. These logs are not a complete CPU,
  I/O, connection-wait or downstream-dependency trace.
- Today's dashboard reported Healthy, 5/60 connections, CPU 2%, RAM 50%, disk 14%,
  and no advisor issues. This current snapshot cannot rule out historical pressure.
  The historical 22:28 snapshot similarly cannot establish conditions at 22:25.

## Defensible conclusion and mitigation boundary

| Candidate explanation | Conclusion |
| --- | --- |
| Upstream gateway timeout response | **Confirmed HTTP 504** in three gateway rows and corresponding application failures. Which upstream hop timed out is unknown. |
| Application's own 10-second deadline caused the 22:25 failure | **Contradicted** by actual HTTP 504 received after 5,030 ms. |
| Auth service latency/failure | Possible; no exact matching Auth record or service trace proves it. |
| Database pressure/lock/connection wait | Not established; retained informational logs and later health do not exclude it. |
| Gateway-to-Auth network/connectivity or downstream dependency | Possible; no connection-phase or dependency trace identifies it. |
| SMTP caused these failures | Not established. Signup and password requests both failed; no SMTP diagnostic was read that proves causality. |

No evidence supports changing timeouts, compute, SMTP, Auth settings or retry policy.
Keep one provider attempt, the existing header/body deadline, coarse non-enumerating
503, UUID-only correlation metadata and explicit user retry. The already-tested
transport hardening is resilience evidence, not resolution of provider reliability.
No controlled staging credential operation was run merely to obtain a later green
result; hosting/deployment and user/session mutation gates remain closed.

The [sanitized support packet](supabase-support-packet-20260920.md) is prepared but
**not sent**. Provider correlation is the remaining dependency for a deeper cause.

## Independent local continuation

`reconcileJobDeliveries` now observes committed fan-out loss, unknown event types,
unexpected consumer/scope routes, expired dispatcher leases and retained outbox
intent after household deletion. Delivery and routing counts share one SQL statement
snapshot through `Database.withHousehold`, with no network call, write or automatic
replay. The closed `JOB_ROUTES` contract supplies the expected fan-out.

The first new deletion case exposed intentionally retained outbox rows. The final
implementation reports `orphaned_events` separately instead of silently discarding
that privacy obligation or treating deleted-household work as dispatchable. These
counts are diagnostic, not deletion receipts. No migration or role change was added.
Scanner/redaction isolation, actual retention cleanup/receipts, activation, deployment
and full synthetic document lifecycle remain separate gates. This is a bounded local
reconciliation increment, not a finished scanner or launch candidate.

## Verification and continuation state

Tested implementation commit: `25a2272c211f89975f7d26a4e691a7b65d91e0a5`.
Full build/lint/typecheck passed; **1,370 units and 452 integrations** passed
(75 DB + 377 web), with 13 existing script lint warnings and zero errors. Seven
architecture guards passed. All five new reconciliation cases fail against the
historical implementation; after byte-exact restoration, all 16 job cases pass.
[Machine-readable receipt](evidence/supabase-local-continuation-20260920.json) records
log hashes and boundaries. [Reconciliation design](job-reconciliation-20260920.md).

Only disposable PostgreSQL 18.3 was used: 13 completed migrations, zero rolled back,
21 forced-RLS tables, 27 policies, no ensure_rls trigger; app_user is neither superuser
nor BYPASSRLS and owns no tables. These are local counts, not fresh staging counts.
The task-owned cluster is stopped after verification. All 386 original inventoried
user files remain unchanged. No commit was pushed; no PR/CI/deployment update occurred.

Next: obtain explicit authorization before sending the prepared provider packet.
A provider response or exact request-linked service trace is needed to distinguish
the remaining causes and complete historical management-token invalidation proof.
Independent local implementation remains: scanner process isolation and bounded
scan verdicts, durable dispatch/reconciliation invocation, retention deletion receipts,
then safe redaction and document lifecycle. No hosted activation follows from these
local tests. Stripe TEST/Plaid Sandbox and recovery/privacy lifecycles remain open.
Production preflight remains **NO-GO**; this report makes no full-stack claim.
