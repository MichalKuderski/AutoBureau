# ADR-018 local scanner, parser and erasure continuation

**Local synthetic development evidence only. Production preflight: NO-GO.**

Continuation branch: `codex/review-pellum-hardening-v2`, isolated worktree
`/private/tmp/pellum-native-review-20260920`. Base: `8c6892d1b1a904da98ea6f2f591c5209ffaf7d90`.
Git confirms its delta from `163367485e6aef3c75b6a4f65d92884147a3658a` was five
report/evidence files only. The review worktree was clean before changes. All 386
inventoried original-checkout files, including the user's modified `CLAUDE.md`, are
preserved. No push, PR #5 mutation, merge, workflow dispatch, deployment, hosted
migration, provider configuration change or Production access occurred.

Implementation SHA: `2aec08a2ceb77f2fd7eea21713aba90146bb3c81`.
The subsequent documentation/evidence commit is resolvable from Git; it changes no
implementation. Focused commits:

- `051c9ae`: complete canonical PDF subset and closed projection.
- `8eeca04`: pinned local ClamAV sandbox, release-bound protocol and measured lease.
- `2fb184c`: manifest-bound local row erasure, independent synthetic storage evidence
  and an explicit local lifecycle proof.
- `78d63c1`: same-household composite foreign-key checks on four document/erasure edges.
- `2aec08a`: durable component leases for local row batches and independent retained-record counts.

## Evidence and limits by phase

| Phase | Demonstrated | Still not demonstrated |
| --- | --- | --- |
| Docker | Engine 29.7.2, Linux aarch64, kernel 7.0.12-linuxkit, runc, overlayfs, default seccomp; bounded read-only inventory | Hosted Linux runtime, dedicated worker fleet or kernel-escape resistance |
| Scanner | Official ClamAV 1.4.6 LTS, immutable upstream and derived-image pins, actual engine/signature hashes, clean public PDF, standard EICAR rejection, strict malformed-format refusal | Universal malware detection, independent publisher-signature verification, native ARM64 performance, hosted signature-update operations |
| Isolation | Effective Docker settings plus in-container UID/capability/seccomp/cgroup readback; read-only root; tmpfs noexec and capacity rejection; network attempt denied; stdout overflow, nonzero exit and 40s descendant timeout refused; exact task-container absence | RSS/PID/CPU exhaustion stress under sustained contention; native Linux deployment hardening or continuous-worker admission |
| Orchestration | Real local immutable file adapter → restricted DB claim → actual container → durable nonce/hash/type/release-bound result → one scanned outbox intent; replay does not rescan | Cloud storage adapter, hosted scan invocation, real upload route activation |
| Parser/redactor | Real PDF 1.4 syntax in one canonical one-page public deadline-notice subset; whole-file structural validation and cited variable date; finite enum-only stub projection | Arbitrary text PDFs, real household document types, OCR, raster images, encryption, codecs, embedded files, uncertain regions or real-data redaction efficacy |
| Erasure | Scoped retention DELETE with mature settled fence/manifest and live durable component lease; child-first batches ≤100 rows; write-only count audit; independent verifier; original/quarantine/job/export synthetic object adapters; restore refusal | Complete account/provider/backup erasure; replay-horizon retirement of outbox/inbox/scan journals; final receipt; authenticated independent restore-ledger operations |
| Composed proof | Synthetic storage/scan/parser/review fixture → cited item/obligation/reminder intent → four opaque fan-out sends → fence → local file/row deletion → independent observations and incomplete progress | Product UI review, notification delivery, hosted SQS, live intake or a full product/stable-staging lifecycle |

The proof's review approval is simulated explicitly for a public fixture. It does
not claim a human used the product UI. Its transport records opaque envelopes
locally; it does not call SQS or send a notification. A real scanner is used; the
model provider is a deterministic local stub. These distinctions are material.

## Scanner selection and execution budget

The [official ClamAV documentation](https://docs.clamav.net/manual/Installing/Docker.html)
identifies `clamav/clamav` and warns that signature-bearing version tags can change.
The [upstream support policy](https://docs.clamav.net/faq/faq-eol.html) identifies the
1.4 LTS family; the current 1.4.6 patch was selected after live registry inspection.
[Upstream licensing](https://docs.clamav.net/) is GPLv2. This increment runs the
unmodified engine as a separate local executable; no image is redistributed.
Bundled notices, redistribution obligations, supply-chain attestations and deployment
security review remain prerequisites, not claimed certifications.

Registry/repository: `docker.io/clamav/clamav`. Verified September 20, 2026.

- Upstream index: `sha256:f156095071757e3838caa50265d65e36cdf7f934a27aacf851ea6d2fadbe8200`.
- Linux/AMD64 manifest: `sha256:655c84d3d60f5830c8bc495c9410d39bca86d28723451d8bff5ca62c76bbdcaf`.
- Engine executable: `sha256:68791dcfb6b7822a70578b3b797b84227142f0018460fed22c7c818f5f26d54b`.
- Signature-set manifest: `sha256:20db5c4ea99545311d1081ca0944eb701701686e9e3d7670e9974bc8d0374986`.
- Derived local image: `sha256:6fd4a9a21f9a143db97e50b7d212187b67c7b004097d5f0469ddebef6341d4bf`.
- Daily database: 28122, September 13 06:26:25 UTC. All three CVD hashes are recorded
  in `scripts/scanner/signatures.sha256`; the wrapper refuses databases older than
  14 days. This pin deliberately becomes unusable without a reviewed update.

The published image has AMD64 content, so this Mac's ARM64 Docker Desktop uses
emulation. Cold scans measured approximately 20–28 seconds. The prior 5s/1.5GiB
contract was not treated as evidence that full signatures could fit that budget.
The derived image strips upstream configuration by copying its pinned filesystem
into a scratch image, with a fixed wrapper and no updater/daemon activation.

The local budget is 3GiB RAM, no extra swap, one CPU, 16 PIDs, 64 descriptors,
64MiB tmpfs, 25MiB input, 1KiB stdout, 40s whole-container watchdog and 5s cleanup.
The application boundary allows 46s for that supervised operation. The independent
DB-time scan lease is 90s: 5s load + 40s scanner + 5s cleanup + bounded DB/scheduling
margin. This is not a latency SLO or permission to change ADR-017's DB-only queue
worker timeout. All invocations here are explicit and bounded; no scheduler runs.

ClamAV's internal scan-time option documents skip-as-clean behavior. The wrapper
sets that internal limit to zero and relies on the external fail-closed watchdog;
file/expansion/recursion limits have exceed-limit alerts enabled. Raw scanner output,
signature names and stderr go to `/dev/null`; the wrapper emits only CLEAN, REJECTED
or ERROR. The trusted broker validates that closed status and the actual container
exit/OOM state, then supplies the inspected release binding. No source-selected
command, filename, environment, URL or shell expression is executed.

A malformed PDF, including an EICAR string merely prefixed by a fake PDF header,
can be AV-clean. The final adapter refuses such content as **indeterminate** unless
the separate canonical-format gate succeeds. The standard unwrapped EICAR file is
rejected by the same inspected engine. Neither observation establishes universal
malware detection. An initial self-signal PID-1 crash fixture did not actually exit
nonzero under emulation; the corrected crash probe uses explicit exit 70 and proves
that a real nonzero termination fails closed. Earlier failed experiments are retained
in local logs, not counted as passing evidence.

## Parser and provider boundary

The supported subset has one page, five fixed objects, Helvetica, one uncompressed
content stream, two literal strings, classic xref and a fixed trailer. Only a valid
calendar date varies. Every byte, offset, stream length, object, page and EOF must
match a complete canonical serialization. No repair, partial parsing, decompression,
OCR or unknown metadata is accepted. Input is ASCII and ≤4096 bytes. This is a
narrow real-format foundation, not a useful arbitrary-document parser yet.

Adversarial cases include encryption/actions/attachments, additional pages, malformed
xref/lengths, Unicode, OCR substitutions, MRZ/QR/barcodes, identifiers, tokens, URLs,
filenames, metadata and prompt injection. Every single-byte mutation of the public
PDF is tested. A regex is used only to locate the candidate date; whole-format
reconstruction is the admission condition, and removing that condition makes 39
parser tests fail. No claim rests on a list of identifier regexes.

The existing unforgeable single-use capability remains the provider boundary. Only
fixed version/task/kind enums reach the local stub. Dates, source hashes, citations,
metadata and all source bytes remain local. There is no model transport or decrypt
capability. This does not authorize an external synthetic-identifier test.

## Erasure authority and remaining boundaries

The retention worker receives DELETE and opaque-column SELECT on nine local domain
tables, not general table reads, secret ciphertext, audit reads, identity deletion,
provider deletion or journal deletion. Its DB trigger requires a matching household,
verifying deletion request, settled fence and manifested component. App/scanner
roles cannot use this authority. Four explicit tenant policies let retention and
verification inspect notification ownership without broadening user access.
Provider-linked notification deliveries refuse deletion while their provider locator
remains unresolved, so erasure cannot silently destroy the evidence needed for
provider cleanup. No SECURITY DEFINER or bypass grant is added.

The row adapter performs one child-first batch of at most 100 rows per invocation,
serialized with the household privacy fence. Every component has a durable attempt
with a database-time 30s lease and stable operation ID. Both the scoped query and
DB trigger validate attempt/token/resource/household/component binding, expiry and
uncompleted state. Transaction-local settings confer no authority without that
matching journal. The batch and count-only audit (with opaque attempt/resource IDs)
commit atomically. Repeated/concurrent calls serialize. A precommit failure rolls
back both data and audit; a crash after commit but before acknowledgement resumes
from remaining rows under a renewed attempt without deleting those rows twice.
Retries remain capped at three; exhausting them requires reconciliation, never an
unbounded retry. Empty-table progression is resumable without an offset cursor.

This reports only local row drainage. Acknowledgements remain distinct from an
independent absence observation. In the proof, the documents attempt is acknowledged
only after both the synthetic original object and document rows have been removed.
Retained notification, outbox/delivery/inbox and scan-journal counts are independently
reported as remaining; empty local copies alone remain unknown for those multi-system
coverage classes. Complete paginated inventory reconciliation for larger stores and
provider-specific erasure are still required before activation.

A second local filesystem adapter independently observes namespace absence. Paths
are closed opaque IDs, creation is exclusive, reads refuse symlinks/oversized files,
and writes/deletions sync the directory. All fixture roots are task-owned. This is
logical immutable-storage behavior behind a trusted local broker, not S3 Object Lock
or protection from a malicious same-user host process. The scanner receives no mount.

The filesystem fence ledger sits outside the data snapshot and rejects operations
when old files are restored. Its restore gate **never permits activation** from local
absence alone: an authenticated, complete, independently retained deletion ledger
is still needed. It cannot prove a missing tombstone never existed. Provider erasure,
backup expiry (documented ceiling 35 days), security holds and account/identity
coverage remain separate. Outbox/delivery/inbox and scan journals remain fenced and
retained; no replay-horizon or provider-retirement evidence is fabricated.
`finalReceiptIssuable` remains false. Metadata retention/pseudonymization also needs
completion; retaining evidence must not become indefinite personal-content retention.

## Migration and validation evidence

Five new **local-only forward migrations** replace the scan-budget function, grant
fenced row-erasure authority, add scoped notification policies/provider-reference
protection, enforce four tenant-reference edges, and require live component leases
for local deletes. Each is transactional. No new table, RLS bypass, SECURITY DEFINER
or runtime owner is introduced. The function/grant/policy changes are catalog work;
erasure is explicitly batched. Rollback starts by stopping invocations and revoking
new DELETE authority. Restore old guard bodies only while execution stays disabled.
Never remove fences/evidence; erased data is not recreated by schema rollback.

A newly written regression proved that the prior restricted application role could
insert four cross-household links: chunk→document, item→source document,
obligation→item and reminder→obligation. All four tests failed against `2fb184c`.
This is a demonstrated referential-integrity gap, not a claimed exploit of every
cascade. [PostgreSQL documents that FK checks bypass RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
The new SQL-owned composite checks bind each parent ID to the child's household,
while preserving the existing single-column CASCADE/SET NULL actions. Tests now
reject both inserts and updates for all four links and prove valid same-household
cascades and nullable provenance links still work. Future Prisma relation changes
must preserve these extra migration-owned checks; schema.prisma records the three
supporting composite unique indexes.

**The parity migration scans tables and builds indexes while holding DDL locks.**
It deliberately fails atomically on any pre-existing mismatch; it does not repair or
delete data. At an illustrative 100k households with 1m documents, 1m items and 2m
obligations, the three UUID-pair indexes could consume roughly 240–400MB at an
assumed 60–100 bytes/entry. This is not a measured capacity estimate. A hosted apply
requires fresh mismatch/row-count inventory, measured validation/index duration,
maintenance approval and the encoded 5s lock/60s statement ceilings. Rollback removes
only the new checks/indexes with erasure disabled; erasure must never reactivate
without equivalent parity protection. No hosted migration was attempted.

An initial development attempt used the restricted application connection to replace
the scan guard and was correctly denied. It made no function change. The failed
local migration was resolved, then development continued with the disposable admin.
Final verification uses a different fresh cluster: 19 completed migrations, zero
rolled-back/unfinished records, all checksums matching Git. It does not hide or reuse
that failed development attempt as clean-install evidence.

Final uncached candidate results:

| Check | Result |
| --- | --- |
| Frozen dependency install | PASS, pinned lockfile and local store |
| Full build / typecheck / lint | PASS; zero lint errors, 13 existing warnings |
| Unit/regression suite | **1,556 passed**: web 1,303; AI 89; contracts 140; DB 16; ops 8 |
| Disposable PostgreSQL/RLS integration | **515 passed**: DB 138; web 377 |
| Explicit real-scanner synthetic lifecycle | **1 passed**, 30.34s on final candidate; separate from integration total |
| Node infrastructure/acceptance/sandbox/storage controls | **192 passed** |
| Actual CI architecture guard commands | **7 passed** |
| Deliberate security weakenings | **12 detected** across the increment, including the new DB erasure-lease guard |
| Historical cross-household FK negatives | **4 failed before the fix**; final eight insert/update negatives and two valid-action controls pass |
| Fresh migration / role / policy readback | **19/19**, zero rollback/unfinished; 27 forced-RLS tables, 37 policies; 18 privacy fences, six journal audit triggers |
| Tenant parity readback | Four validated, initially-immediate deferrable constraints; three supporting unique indexes |
| Authority / cleanup readback | Zero provider grants, runtime-owned tables, new SECURITY DEFINER or new-role memberships; new workers NOLOGIN with passwords cleared; all synthetic journals and job delivery/inbox rows removed |

The earlier 11 source/trigger mutations and later erasure-lease mutation were each
restored before final validation. Four historical FK failures are reported separately,
not inflated into the security-mutation count. The initial combined Turbo build plus
typecheck run raced on generated Next `.next/types` files and failed. Sequential
build → typecheck → test phases passed; no timeout or test expectation was relaxed.
An added verifier fixture initially supplied hex text where Prisma expects bytes;
that synthetic-fixture error was corrected and all 48 document-security integration
checks pass. Failed experiments remain in the hash inventory and are not green runs.

All task scanner containers are absent. The two original stopped Redis/PostgreSQL
containers and their images remain unchanged; task scanner/probe images are retained
for reproducibility. Task-owned PostgreSQL was stopped after readback; its isolated
cluster/evidence files remain available. No Docker prune/reset or user-data cleanup.

Native results and hashes are in
[evidence/adr018-local-scanner-20260920.json](evidence/adr018-local-scanner-20260920.json).
The final candidate uses Node 22.16.0, pnpm 10.34.5, TypeScript 5.9.3, Vitest 3.2.7,
Prisma 6.19.3, Next 15.5.22, PostgreSQL 18.3 and pgvector 0.8.1. This is not CI
PostgreSQL 16 or Supabase verification. Lint retains 13 pre-existing warnings; React
act/error-boundary warnings are preserved. No secret values enter the receipt.

## Continuation order and release gates

1. Complete inventory reconciliation at larger limits and retained job/scan evidence
   retirement. Define authenticated independent restore-ledger operations and provider
   retention attestation before any activation. The bounded local execution/lease path
   is now exercised; this is not a complete account-erasure product. Never weaken
   final-receipt refusal to complete a demonstration.
2. Expand supported parsing only with complete format coverage, independent fixtures
   and evidence; OCR, raster files and arbitrary real PDFs remain refused. Review
   scanner update/attestation process and native target-platform resource behavior.
3. Separately authorize any hosted synthetic scanner/storage/queue/retention evidence.
   Current local adapters cannot establish real provider deletion or backup expiry;
   no amount of local stub testing can retire those external facts.
4. Continue recovery/MFA/privacy, Stripe TEST and Plaid Sandbox lifecycles and UI QA;
   none gains readiness from this document increment. No real account connection,
   billing, document intake, model processing or rollout follows from these tests.

The three September 13 Supabase gateway 504 records remain established; the deeper
request-linked timeout hop remains unknown. No credential retry or timeout-hiding
change was made. OAuth revocation/replacement remains established, historical
management-token invalidation unproven, and the support packet PREPARED BUT UNSENT.
No Supabase/other management session was used here. US/English, one account holder
and provisional $12/month or $99/year Premium remain unchanged. Legal/operator,
provider approval, exact-candidate hosted acceptance and rollout gates remain open.
**NO-GO for Production preflight; no full-stack or launch-readiness claim.**
