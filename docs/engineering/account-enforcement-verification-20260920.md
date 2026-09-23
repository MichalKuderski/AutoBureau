# Local account, export and TEST reconciliation checkpoint

**Local increment verified; full continuation programme incomplete. Production
preflight NO-GO.** This is neither full-stack nor stable-staging evidence.

## Source and preservation

Worktree `/private/tmp/pellum-native-review-20260920`, branch
`codex/review-pellum-hardening-v2`. Started at intentional newer `b5b41b0c2d2545435a3cdaa44456f502c111574d`:
Git comparison against `fe7840a` showed only the private Sites binding and local-preview
document. The original checkout and all 386 inventoried user files are unchanged.
No stash, reset, clean, push, merge, remote PR edit, deployment or provider mutation.
PR #5 was not queried again; its previous draft status is not a new remote readback.

Tested implementation: **`e30637274b868d0fd7f6ff4d8c02cf4b6cf72beb`**.
Tested tree: `4878ea4fb7c821a39a10e350b27cbc8f45581785`.
The subsequent checkpoint commit changes documentation/evidence only; its final SHA
is reported in the task response to avoid a self-referential commit hash.

Focused local commits:

- `347a86c`: centralized sensitive admission, current-account recovery ports,
  shared durable recovery limits, local strength and bounded breach-check boundary.
- `edfdc47`: encrypted export publication journal, durable revocation, authenticated
  expired pending-file sweep and expanded consistent safe snapshot.
- `72d23df`: official SDK TEST refetch, independent ownership checks, bounded domain decision.
- `cb1079b`: activation guard for unmounted account/billing foundations.
- `8e81865`: password-check header deadline independent of adapter abort compliance.
- `e306372`: binding-wide billing claims, durable TEST decisions and atomic outbox,
  audit and notice completion; grace/cancellation regression fixes; privacy coverage.

## Implemented and still gated

| Area | Evidence-backed state | Remaining requirement |
|---|---|---|
| Central sensitive policy | Signed principal/session, live owner/active account/fence/MFA requirement, refreshed provider factors, recent password or AAL2/TOTP; before/after I/O checks | Whole-app integration and transaction-time enforcement at every sensitive operation; policy/controller presence alone is not full MFA |
| MFA | Existing enrollment/challenge/verification/removal controllers retain shared durable one-use journal, origin checks and bounded limits; enrollment/removal refresh admission before effects | Unmounted; real provider rotation/revocation and ingress evidence, application-wide enforcement and accessible UI |
| Recovery | Request-bound shared limits; active owner admission; selected-factor refresh; AAL2 commit requirement where needed; forced sign-in and coarse failure | Unmounted; no lost-factor bypass, no claim of immediate JWT invalidation; provider email/expiry/replay proof remains |
| Password | zxcvbn 4.4.2 score at least 3, bounded exact password, fixed HIBP five-character SHA-1 prefix request, padded bounded strict response, independent 3s whole transport deadline, no retry | No real HIBP calls. K-anonymity reduces disclosure; it cannot guarantee resistance to dictionary reconstruction. Wire tests prove no full password/hash/body/cookie transmission, not impossibility of inference |
| Export | One MVCC SQL snapshot of account/profile/household, safe registry/provenance/reminders, preferences and safe history, entitlement and safe TEST subscription projection; encrypted immutable local artifact, publication journal, DB revocation, expiry and bounded authenticated pending sweep | **Partial**: no complete originals + JSONL + audit ZIP, bulk identifier reveal, arbitrary attrs/free text, complete financial records or completion notification. Hosted key custody and invocation absent |
| Deletion | New artifact and billing-state journals inventoried using narrow privacy-worker projections; fences prevent access/processing | `finalReceiptIssuable=false`; no journal retirement, operational independent restore authority, provider or backup erasure proof |
| Stripe TEST | Official SDK refetch checks account/customer/subscription/invoice/price/product; no automatic SDK retries. Binding-wide DB exclusion, live lease/token/revision fencing, state + terminal notice + audit + opaque outbox atomically. Duplicate/late notices refetch current state. Expired diagnostic eligibility denied on DB clock | **No application Premium/cap activation**. Dedicated billing runtime/authority, cap gateways, missed-webhook intent, checkout/portal and real TEST lifecycle evidence still required. No entitlement-write grant added to generic worker |
| Plaid | Existing partial Sandbox foundations unchanged; full regression suite includes existing tests | Durable custody/Item/account/inbox/cursor/sync/reconnect/unlink/export/erasure remain required local engineering; no real provider or account connection |
| UI/accessibility | No unsupported controls added; local public-page preview restored | No new MFA/recovery/privacy/billing UI or exhaustive browser/accessibility evidence claimed |

See [account policy details](account-enforcement-20260920.md),
[export journal](export-publication-journal-20260920.md), and
[TEST reconciliation](stripe-test-reconciliation-design-20260920.md).

The registration **Pellum — Development** retains the existing private unpublished
Sites binding. `http://127.0.0.1:4317/` returned 200 with Pellum's title after restart.
It has live reload and no provider credentials or authenticated backend. It is not
hosted application evidence. See [preview scope](local-live-preview.md).

## Final native verification

[Machine evidence and log hashes](evidence/account-enforcement-native-20260920.json)
record the exact source, SQL readback, roles, checksums, versions and negative controls.
Raw evidence stays under `/private/tmp/pellum-account-enforcement-20260920`.

| Check | Result |
|---|---|
| Frozen offline lockfile install | PASS |
| Full forced build/typecheck | PASS, no cache reuse for the candidate |
| Lint | 0 errors, 13 pre-existing warnings; Next ESLint-plugin detection warning retained |
| Units/regressions | **1,822**: ops 8, contracts 152, AI 89, DB 40, web 1,533 |
| Disposable PostgreSQL/RLS | **625**: DB 212, web 413; actual non-privileged role assertions |
| Local infrastructure/acceptance controls | **195**, no cloud execution |
| Architecture guards | **7** |
| Real pinned local ClamAV lifecycle | **1 passed in isolation**; failed concurrent run retained below |
| Deliberate security weakenings | **27 detected and restored**, including SQL exclusion, revision, outbox, MFA/recovery, password, export and restore controls |

Node 22.16.0; pnpm 10.34.5; Next 15.5.22; TypeScript 5.9.3; Vitest 3.2.7;
Prisma 6.19.3; Stripe 22.6.2 requesting Clover `2026-02-25.clover` with closed runtime
validation; PostgreSQL 18.3; pgvector 0.8.1; ClamAV 1.4.6 pinned image/signatures.
PostgreSQL was a fresh disposable loopback cluster on port 55540, never staging.
It is stopped after final readback. The separate preview remains running.

Readback: **24 completed migrations; 0 unfinished/rolled back; 24 checksum matches;
32 forced-RLS tables; 42 policies; 23 privacy fences; 11 journal audit triggers**.
Zero `ensure_rls`, new SECURITY DEFINER functions, provider table grants or runtime-owned
tables. Existing role attributes unchanged (including the already-reviewed dispatcher
BYPASSRLS exception); no new roles. Temporary worker logins cleared. All inspected scan,
delete, challenge, export, billing and job fixture journals are empty. Migration 24
includes lock/scale/rollback notes; no hosted migration or historical checksum rewrite.

## Failures, fixes and retained risk

- A password transport originally depended on fetch honoring its AbortSignal.
  Independent deadline handling now catches an adapter that never resolves headers.
- Failed upgrades initially selected the current unpaid plan for grace; now they
  retain the paid plan. Scheduled cancellation now bounds grace as well.
- TEST notices originally serialized individually. Different notices for the same
  binding now exclude each other in application code and the invoker SQL trigger.
- One full unit invocation ran without loopback permission: `listen EPERM` caused
  fixture failures. The entire suite passed with local-socket permission. No provider
  retry or timeout was changed to obtain that pass.
- One ClamAV lifecycle ran alongside the full unit suite and returned **queued**
  after approximately 43.15s. It did not advance to clean. The exact broker failure
  was not captured; resource contention is plausible, **not established causality**.
  An isolated direct adapter probe returned clean in 19.612s; the complete isolated
  lifecycle passed in 22.908s. Keep the failed run: hosted/load scanner reliability
  remains open. No scanner limits were increased and no continuous worker activated.
- Development syntax/type mistakes and an uncompilable first outbox mutation are
  retained in local logs, corrected and not counted as passing behavioral evidence.

## External dependencies and next engineering order

The September 13 three upstream gateway 504s remain established; the deeper hop is
unknown. Historical Supabase management-token invalidation remains unproven. The
[sanitized packet](supabase-support-packet-20260920.md) remains **PREPARED BUT UNSENT**.
Only provider request-linked evidence can retire those risks. Do not infer a fix
from this local suite, add credential retries, increase Auth timeouts or send support.

ADR-019 remains **APPROVE WITH REQUIRED AMENDMENTS**. Operational independent key
custody/checkpoints/admission, witnessed durability and hosted restore drills need
separate authority. Do not manufacture final deletion receipts from local fixtures.

Independent local engineering still remains; these provider gates do not excuse it:

1. Complete central policy integration and transaction-time ownership/fence/MFA
   checks across each sensitive server operation, then local HTTP lifecycle tests.
   Keep hosted activation gated on trusted ingress and provider session evidence.
2. Design/review originals and audited identifier access; finish safe export coverage,
   complete artifact packaging and notification intent. Continue privacy reconciliation
   without retiring protected journals or claiming provider/backup absence.
3. Isolate a dedicated billing runtime/DB capability; connect reconciled TEST state to
   reviewed cap configuration and every gateway's current-time checks. Add distinct
   internal missed-event intent (never fabricate Stripe event IDs), lifecycle invocation
   and reconciliation before real TEST provider proof or UI activation.
4. Complete Plaid Sandbox durability, encrypted custody, sync/cursors and privacy
   behavior; use official local fixtures if provider access remains gated.
5. Add backend-supported UI and browser/accessibility matrix. Investigate scanner
   performance under controlled local resource load before any hosted service gate.
6. Obtain separately authorized hosted/provider evidence and final exact-SHA staging
   acceptance. No deployment, merge, Production, Live payment, real financial data,
   sensitive-document/model processing, DNS or public launch is authorized here.

Legal operator/jurisdiction/public contact decisions remain prior launch dependencies;
no legal readiness is inferred. The US/English single-account-holder model and
provisional $12/month or $99/year direction remain unchanged.

**Production preflight: NO-GO.** Local checks retire specific implementation risks;
they do not complete the requested full application programme or establish launch readiness.
