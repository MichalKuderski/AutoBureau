# Document security foundations — September 20, 2026

Historical checkpoint before founder approval of ADR-018. The later [approved local implementation](adr018-local-foundations-20260920.md) supersedes its proposal status and implementation counts; this report preserves the earlier evidence.

**Local development evidence only. Production preflight: NO-GO.**
Branch: `codex/review-pellum-hardening-v2` in
`/private/tmp/pellum-native-review-20260920`.
Started at `78269413bc7ed82306d7569ae90914db4671683b`. Git confirms that the five
files between that HEAD and the previously tested `25a2272` are documentation or
evidence only. No historical base was assumed or reset.

Tested implementation SHA: `3913413791c550ac90c004b7f0929b83430a8e8c`.
Final validation is recorded in the accompanying
[receipt](evidence/document-security-native-20260920.json). A later documentation
commit does not change the tested implementation. The original checkout, modified
`CLAUDE.md`, and all 386 inventoried user files remain unchanged.

## Implemented boundaries

### Scanner protocol and synthetic process

`scanQuarantinedSnapshot` copies input bytes, hashes the authoritative snapshot,
issues one nonce and accepts only a strict, bounded reply bound to that exact
nonce/hash/size/type. Clean, rejected, indeterminate and scanner-error are closed
verdicts. Unsupported, empty, oversized, malformed, extra-field, inconclusive and
timed-out results cannot issue a clean receipt. The supervisor caps input at 25 MiB,
reply at 1 KiB, deadline at five seconds and attempts at one. Exceptions and arbitrary
scanner output never appear in returned errors. A mutable Buffer view cannot alter
the authoritative snapshot. A JSON object saying "clean" is not an issued receipt.

A real separate child process tests the protocol using one exact public literal,
a fixed executable/script, fixed LANG/NODE_ENV environment, bounded Node heap/output
and abort signal. It has no injected application credentials. **It is not an antivirus
engine or OS sandbox.** No production scanner adapter or application route is wired.
An arbitrary port could allocate before returning, block synchronously, ignore
termination or falsely claim clean; only an independently enforced process/container
boundary and engine evaluation can retire those risks. Heap flags do not establish
RSS, CPU, filesystem, process-group or network isolation.

### Durable bounded dispatcher invocation

`runHouseholdDispatchOnce` performs household/scope reconciliation, refuses unknown
events, missing fan-out, invalid routes or retained deleted-household intent, routes
at most 50 intents, attempts at most one send, and reports a fresh reconciliation.
It adds no scheduler, cross-tenant escape hatch, repair, DLQ replay or continuous worker.

Transport cannot hold the invocation indefinitely by ignoring AbortSignal. A failed
or ambiguous send remains retryable under the existing three-attempt cap. A crashed
last lease becomes exhausted rather than idle. Late transport completion can still
produce a duplicate delivery; only the transactional per-consumer inbox/domain
commit establishes completion.

Send outcomes require the same pending row, household, scope, lease token and an
unexpired lease. Lease/retry timestamps now use PostgreSQL time. Outcome processing
locks the row before checking current expiry: a runtime clock offset or time spent
waiting on a row lock cannot prolong ownership. Four new real-DB cases reproduced
the previous failures, then passed after correction. No network operation occurs
inside a household transaction. RLS/role grants and schema remain unchanged.

### Deletion evidence coverage

`assessDeletionEvidence` requires exactly one scoped, fresh observation for each of
12 coverage classes, a completed 14-day grace interval and an explicit write-fence
timestamp. Missing, duplicate, unknown, nonzero-absence, mismatched, stale, premature
or malformed evidence cannot become a complete assessment. Bounded backup/provider/
security-hold exceptions are disclosed separately; they cannot excuse retained
document bytes, secrets, quarantine or outbox content.

This is a completeness checker, **not deletion authority, an authenticated journal
or a deletion receipt**. `receiptIssuable` is always false, including structurally
complete assessments. It does not prove that observations are truthful, that a write
fence exists, that retention exceptions were authorized, or that a provider/backup
has erased data. Those checks need independently verified durable state.

[The coverage manifest](document-retention-coverage.json) classifies all 24 current
Prisma models plus external objects/providers/telemetry/backups. A guard fails if a
new model has no reviewed category. It calls out unassigned inbound email, account
vs household scope, retained outbox/audit rows, object versions/orphans, anonymous
TTL counters and provider/backup limits. No personal content, object, audit row,
provider reference or job evidence is deleted in this increment.

### Pre-model boundary

The architecture conflict is explicit in proposed [ADR-018](../architecture/adr/ADR-018-document-scan-redaction-and-deletion-boundaries.md):
doc 05's original-image vision path can expose identifiers before any redaction.
No-decrypt permission alone cannot prevent a model reading identifiers in an image.
The constitution takes precedence; no raw image/OCR/free-text path is activated.

The local review stub accepts only the exact public literal after a bound scan. It
projects one cited date with document/household binding and a content hash, freezes
the result and requires human review. It has no provider transport. Arbitrary text,
images, metadata, filenames, OCR, prompt context, retries and dead-letter payloads
cannot pass through this interface. Adversarial synthetic strings cover identifiers,
Unicode, overlapping/repeated identifiers, credentials, MRZ/barcode-like content,
malformed input and prompt injection. Even same-length changed bytes with a fresh
nominal clean scan are refused. No synthetic sensitive-looking fixture left the
local process. No obligation, item, reminder or automatic approval is created.

This proves the exact-fixture restriction, **not real-world identifier detection or
redaction accuracy**. No parser/OCR or external-model SDK was added. A static guard
also keeps these experimental modules unreachable from application routes; it is a
backstop, not a general transitive capability or sandbox proof.

## Verification and limitations

| Native check | Final result |
| --- | --- |
| Frozen-lockfile dependency validation | PASS, offline pinned store; no lockfile changes |
| Build / typecheck / lint | PASS; zero errors, 13 existing lint warnings |
| Unit/regression suite | **1,443/1,443**: web 1,294, contracts 125, DB 16, ops 8 |
| Disposable PostgreSQL/RLS integration | **467/467**: DB 90, web 377 |
| Infrastructure/acceptance/document Node controls | **156/156** |
| Exact CI architecture shell guards | **7/7** |
| Focused scanner/review / deletion / job cases | **47 / 26 / 31**, included above |
| Security mutation controls | Four deliberate weakenings each trigger the intended failure |
| Clock/lock regression controls | Four assertions fail before the fix, pass afterward |
| Original user-file inventory | **386/386 unchanged** |

Toolchain: Node 22.16.0, pnpm 10.34.5, TypeScript 5.9.3, Vitest 3.2.7,
Next 15.5.22, Prisma 6.19.3. Database: PostgreSQL 18.3, pgvector 0.8.1.
Final local read-back: **13 completed / 0 rolled-back / 0 unfinished migrations,
21 forced-RLS tables, 27 policies, no ensure_rls trigger**. Runtime roles own zero
tables. `app_user` and `app_job_worker` are non-superuser/NOBYPASSRLS; the existing
narrow `app_dispatcher` retains its documented BYPASSRLS discovery authority, with
no new grant. Worker/dispatcher return to NOLOGIN after tests. Job delivery/inbox
fixture counts are zero. The task-owned disposable cluster is stopped after read-back.
This is not a hosted role/migration snapshot.

The machine-readable receipt carries exact totals, versions, commands, local DB
posture, mutation results and SHA-256 log hashes. Final build/typecheck/unit/integration
commands bypass Turbo cache. The frozen-lockfile install is offline against the
already provisioned pinned store; no dependency or lockfile changed. pnpm retained
its existing dependency-build-script warning; the repository's explicit Prisma
generation and complete build succeed. Lint retains 13 existing console warnings
and zero errors. An initial scanner-test environment typing failure was corrected
with fixed `NODE_ENV=test`, without inheriting application environment variables.
One targeted command used a nonexistent Vitest config and was corrected to the
repository's actual configuration; that startup failure is not a negative-control
result. Four actual clock/lock regression assertions failed before the fix.

Security mutations independently remove nonce binding, exact-fixture matching,
deletion grace and lease expiry. Each makes the intended assertion fail. All
mutations are restored byte-for-byte before final verification. The restricted
worker/application roles exercise tenancy; admin is used for synthetic setup,
corruption/failure injection and independent inspection. PostgreSQL 18.3 + pgvector
on loopback is local evidence, not CI PostgreSQL 16 or hosted staging evidence.

No migration, provider request, hosted acceptance, browser QA, infrastructure apply,
push, remote PR modification, workflow dispatch, deployment, merge or real-data use
occurred. PR #5 was not remotely rechecked and remains unchanged by this work.
Rollback is a local code revert; no provider/schema teardown is needed.

## Retained diagnosis and release gates

[Supabase diagnosis](supabase-diagnostic-followup-20260920.md) is unchanged: three
September 13 upstream gateway HTTP 504 records are recovered, but no exact matching
Auth-service record or request-linked DB/dependency trace identifies the deeper hop.
Later success is not a fix. One-attempt bounded auth transport, coarse errors and
UUID-only diagnostics are preserved. No timeout increase or credential retry was added.

OAuth revocation/replacement is established; historical Supabase management-token
invalidation remains unproven. The [support packet](supabase-support-packet-20260920.md)
remains **prepared but unsent**. No provider/account access occurred in this increment.

## Decision boundary and next implementation order

**A–D are not fully complete.** The added local contracts are useful foundation
evidence; they do not justify a complete document lifecycle, real intake, hosted
scanner, continuous workers, redaction deployment or model processing. The next
document architecture decision is review of ADR-018's replacement for raw-image
vision. Synthetic exact-match tests cannot decide acceptable real-content disclosure
or prove OCR/identifier coverage. Do not silently approve the proposal or weaken
the constitution to continue into extraction.

After that decision, keep this order:

1. Select/pin the actual local scanner sandbox and engine; enforce no network,
   credentials, writable host mounts or inherited authority; prove hard termination,
   RSS/CPU/process bounds and hostile-format refusal. Separate hosted activation
   still requires authorization.
2. Design durable scan/quarantine and deletion-fence/journal migrations with explicit
   100k-household lock/size estimates, rollback, role grants and RLS tests. Implement
   provider-neutral adapters and restore-fence replay before any deletion receipt.
3. Implement approved local parsing/redaction and write-only secret custody; retain
   fail-closed handling for unknown/OCR/barcode regions; adversarially prove provider
   egress denial and provenance. No real sensitive/model-provider tests.
4. Build one synthetic full lifecycle through review, cited domain writes, reminder
   intents, retries/reconciliation and independent erasure evidence. Do not label the
   present scan-to-local-review fixture a full intake/processing lifecycle.
5. Then recovery/MFA, export/account/provider deletion; durable Stripe TEST lifecycle;
   Plaid Sandbox custody/persistence/sync/unlink; UI/accessibility; only separately
   authorized exact-SHA staging deployment and hosted lifecycle verification.

Unresolved local work is not mislabeled as a provider outage. The architectural
decision blocks advancing arbitrary document content; it does not close the broader
implementation backlog. Provider diagnosis/management-token invalidation and legal
operator/jurisdiction/contacts remain genuine external dependencies. Sending the
support packet requires explicit authorization. All prior AWS/SNS/provider evidence
is historical, not freshly verified here.

US/English, one account holder managing household members, and provisional $12/month
or $99/year Premium are preserved. Production, live charging, real financial accounts,
real sensitive documents/model processing, DNS, merge, deployment and public launch
remain separate closed gates. **NO-GO for Production preflight.**

Local implementation commits:

- `7b1dd13`: scanner protocol, exact synthetic review seam and proposed ADR-018.
- `8f945cf`: bounded reconciliation/dispatch and database-clock lease fencing.
- `3913413`: deletion-evidence coverage, model inventory and document CI guards.
