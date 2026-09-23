# ADR-018 approved local foundations — September 20, 2026

**Local development only. Production preflight: NO-GO.**

This continues the clean `e4cbca92a54d059cabd73cf1173cff29f7252e3a` checkpoint in
`/private/tmp/pellum-native-review-20260920`, branch `codex/review-pellum-hardening-v2`.
The original checkout and its 386 inventoried user files are preserved. No push,
remote PR change, merge, deployment, workflow dispatch, hosted migration, provider
mutation or real-data/model use is authorized or performed here.

The founder approved ADR-018's architecture direction. Arbitrary original document
images are retired as the intended model input. Local parsing/redaction is required;
scan cleanliness is never redaction clearance. Hosted activation remains closed.
Earlier September 20 reports retain their historical proposal status and counts.

## What is implemented, and what the evidence means

| Boundary | Implemented locally | Remaining proof |
| --- | --- | --- |
| Scanner sandbox | OCI broker with fixed executable/socket, digest-only image, effective-settings inspection, no ambient credentials/network/host mounts, resource limits and bounded complete-container cleanup | Docker engine availability; actual image/engine/signature selection and review; Linux enforcement and malicious-document efficacy |
| Durable scan journal | Immutable sealed identity/hash, pinned release digests, DB-time lease, three attempts, closed verdicts, stale-result/supersession/deletion checks, transactional state/outbox/audit | Actual scanner adapter and immutable storage read integration; measured execution bounds; hosted activation |
| One scan invocation | Claim → bounded snapshot load → nonce/hash-bound scan → conditional journal completion; all I/O outside DB transactions | Synthetic port tests, not a complete intake or external-storage lifecycle |
| Deletion journal | Owner request, DB-stamped 14-day undo, serialized write fence, settlement, immutable resource manifest, bounded attempts and independent observations | Complete resource inventory/adapters, online erasure, provider/backup evidence, restore-fence replay, evidence pseudonymization and final receipt |
| Parser/redactor | Whole-format grammar for one explicitly public synthetic record; only fixed enums projected, provenance/date stays local; unknown content refused | No real PDF/image/OCR/embedded-file/barcode parser or real identifier coverage claim |
| Provider boundary | Compile-time brands plus single-use process-local runtime capabilities; deterministic local stub; closed dependency graph | Hosted process/credential isolation and separately authorized real provider gateway; no provider SDK or network adapter exists |

The parser emits no free text, date, identifier, last-four, URL, filename, object path,
source hash, tenant ID, OCR region or provenance in provider input. The only payload
is `{version:1, task:"classify-public-fixture", kind:"deadline-notice"}`. This proves
a conservative projection and authorization seam, **not arbitrary-content redaction**.
A malformed/unsupported source goes to a generic local-review refusal without source
content in errors. Serialized handles, raw documents, scanner verdicts and parsed
handles cannot call the stub. Retry/DLQ envelope schemas refuse source material.

The OCI broker follows the [Docker runtime controls](https://docs.docker.com/engine/containers/run/)
and reads effective settings before exposing stdin. The local Docker socket inventory
succeeded, but privileged read-only engine/image inventory calls timed out. No daemon
restart, user-container operation, image pull or hosted scanner activation occurred.
Required engine/signature image labels bind the reviewed release descriptor; they
cannot themselves prove the contents or efficacy of the image. Test digests are
synthetic, never presented as real release pins.

## Durable authority and deletion limits

The new database workers are distinct NOLOGIN/NOBYPASSRLS roles. The hostile scanner
receives bytes through stdin, never a DB role or application environment. Document
workers can update only the document columns needed for registration/state, write
scan history, audit and outbox intent. Retention workers cannot insert verification
observations. Verifiers can count opaque local links but cannot read secret ciphertext
or document content. All six journals force RLS; cross-household and unscoped reads
are tested on restricted connections, not the admin fixture connection.

The fence and domain writes share a household advisory lock. Eighteen domain tables
are guarded, including job delivery/inbox state. Scan completion checks a current
lease, nonce, hash, sealed object and deletion state. A stale, rejected, superseded,
expired or fenced result cannot advance the document. A clean transition creates one
`document.scanned` outbox intent in the same transaction. Raw SQL journal mutations
are audited by DB triggers; dispatcher claim/outcome raw SQL now explicitly audits.

A mature deletion fence blocks new intake admission, domain writes and processing.
It does not revoke already-issued signed URLs or undo an already-started provider
operation. The journal enforces a 15-minute capability-settlement wait before a
manifest. Actual provider-specific re-inventory, in-flight-effect reconciliation and
namespace absence verification remain required. No claim of complete external fencing
or erasure is made while those adapters are missing.

Manifest entries use opaque resource references and twelve closed coverage classes.
Class coverage is not proof of inventory exhaustiveness. Deletion attempts preserve
one resource operation ID across up to three 30-second DB-time leases. A successful
DELETE acknowledgement is never absence. Independent restricted-role DB inspection
can prove local derived-row or secret-link absence; empty document rows still leave
object/provider erasure unknown. Synthetic observations remain labeled synthetic.

Progress discloses `providerErasure=unverified`, `backupExpiry=unverified`, null
irreversible completion and `finalReceiptIssuable=false`. Final completion is also
blocked in the database. No security hold is authorized, and a retention timestamp
alone cannot authorize one. Actual provider retention, up-to-35-day backup expiry,
restore-fence replay, household-vs-account scope and removal of identity links from
retained journals require further implementation. Keeping audit/journal rows indefinitely
is not the privacy design. No real deletion or final deletion receipt is performed.

## Migration review

`20260920000000_document_security_journals` adds six empty tables and four composite
foreign keys; no existing table is rewritten. Journal history deliberately has no
household/document cascade that would erase deletion evidence. Child-to-journal FKs
are RESTRICT. All household keys remain RLS-scoped. Unique scan object/attempt keys,
one active deletion per household, resource keys and evidence IDs establish
idempotency; household/state and observation indexes support bounded claims/readback.

Installing guards on existing tables takes metadata locks. The migration sets a
5-second lock timeout and 60-second statement timeout; a timeout aborts the whole
migration. New-table indexes have no existing heap to scan. At 100k households, an
explicit planning scenario of 30 scans each gives 3M scan rows and at most 9M attempts
(roughly 6–10 GB including indexes). At 100 deletion resources per household, 10M
resources, up to 30M attempts and 30M observations could need roughly 30–60 GB.
These are rough capacity estimates, not benchmarks or approval for unbounded retention.
Real retention, index bloat and compressed row sizes must be measured before rollout.

Rollback: disable invocations, retain active fences and evidence, and revert callers
independently. Do not drop journals or clear fences to roll back. Destructive schema
rollback requires separately reviewed data handling. The migration is **not deployed**.

During development, local tests caught and corrected an audit UUID cast and a row
lock that required UPDATE authority on an immutable manifest. The latter now uses
a resource advisory lock. A second database in an existing test cluster exposed
historical unconditional role-creation behavior; the final migration verification uses
a fresh cluster. Development-only trigger corrections were not treated as a clean
migration proof. Final evidence must match repository migration checksums exactly.

## Validation receipt

Exact final SHA, tested implementation SHA, commands, versions, totals, warnings,
security mutations and SHA-256 evidence hashes are recorded in
[evidence/adr018-native-20260920.json](evidence/adr018-native-20260920.json).
Tested implementation SHA: `163367485e6aef3c75b6a4f65d92884147a3658a`. The final documentation-only commit is
resolvable from Git. Final results: **1,508 units** (web 1,300, contracts 140, DB 16,
ops 8, AI boundary 44); **492 integrations** (DB 115, web 377); **188 controls**;
**seven architecture guards**; **eight caught deliberate security mutations**.
Frozen install, full build/typecheck/lint pass; lint has zero errors and 13 existing
warnings. The final narrower column grants were revalidated with the full integration
suite on another fresh disposable cluster. No unit implementation changed afterward.
All 14 applied migration checksums match the repository exactly. Read-back confirms
27 forced-RLS tables, 33 policies, 18 active domain fences, six audit triggers, zero
provider grants, zero runtime-owned tables and zero new SECURITY DEFINER functions.
The three new worker roles and existing job roles are NOLOGIN after tests. The
previously reviewed dispatcher retains its existing BYPASSRLS discovery grant;
no new bypass grant is added. All six journals and both job tables have zero fixtures. Task-owned PostgreSQL
clusters are stopped after read-back; the user's separate database is untouched.

Focused local commits:

- `21508e6`: approved scanner/architecture boundary and effective-setting controls.
- `92b9439`: durable scan/deletion journals, bounded invocation and dispatcher audit fix.
- `1633674`: closed synthetic parser/redactor and provider capabilities.

Evidence is native local PostgreSQL 18.3 with pgvector 0.8.1, including restricted
app/worker assertions. It is not CI PostgreSQL 16, Supabase, stable staging, browser
QA, real AV efficacy, real redaction accuracy or launch-readiness evidence. Existing
React test warnings and existing lint warnings are recorded, not silently suppressed.

## Retained external dependencies and exact next order

1. Restore the local Docker engine so a bounded read-only `docker info` completes.
   Restart Docker Desktop yourself if needed; no credential sharing or factory reset
   is required. Then select/review an actual scanner image, executable and signature
   digest and prove Linux resource isolation, descendants killed, no egress and exact
   cleanup with synthetic fixtures. No hosted scanner follows from local proof.
2. Complete broker-to-storage/scan-journal wiring, actual supported-format parsing and
   independent adversarial coverage. Arbitrary real content remains fail-closed.
3. Complete deletion resource inventory/execution/verification adapters, retention,
   restore fencing and journal identity-link expiry. Keep final receipts disabled until
   independent evidence supports every required scope.
4. Only then compose one synthetic intake → review → cited domain write → reminder/
   outbox → dispatch/reconciliation → deletion lifecycle. Current component tests are
   not that lifecycle. No uncited date becomes an obligation.
5. Continue recovery/MFA/account privacy, Stripe TEST durable lifecycle, Plaid Sandbox
   custody/persistence/sync/unlink, and UI/accessibility. Exact-candidate hosted
   deployment and stable acceptance require separate authorization.

Supabase diagnosis is unchanged: three September 13 gateway HTTP 504 records are
confirmed, but the deeper request-linked Auth/DB/network/dependency cause is unknown.
One-attempt bounded credential transport, coarse errors and UUID-only diagnostics
remain intact. OAuth revocation/replacement is established; historical management-token
invalidation is unproven. The sanitized support packet is prepared but **unsent**.
No provider access was used for this increment. Legal operator/jurisdiction/public
contacts and broader release/provider gates remain unresolved.

US/English, one account holder managing household members and provisional $12/month
or $99/year Premium are unchanged. PR #5 was not remotely inspected or modified.
Production, live payments, real financial accounts, real sensitive documents/models,
DNS, merge, deployment and public launch remain closed. **NO-GO for Production preflight.**
