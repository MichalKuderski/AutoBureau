# ADR-018: Document scan, pre-provider isolation and deletion evidence

**Status: Architecture direction approved by the founder on September 20, 2026.**
Approval explicitly retires arbitrary raw-image-to-model processing, requires trusted
local parsing/redaction and fail-closed uncertainty, separates scan cleanliness from
redaction clearance, and denies identifier-decrypt authority to model runtimes.
Local sandbox/journal/parser/capability implementation and synthetic verification are
authorized. Hosted activation, real documents/model calls, deployment and Production
remain separately gated. No new field is permitted across the provider boundary by
this approval.

## Approved resolution of the architecture conflict

Doc 05's raw-image vision path can reveal SSNs, policy/member/account numbers,
passport/license identifiers, routing numbers, credentials, MRZs and barcodes before
the model can redact them. ADR-007's absence of a decrypt grant does not prevent the
model reading those identifiers in an original image. Founding Principles §7.5 and
the explicit real-content prohibition take precedence. Regex masking, OCR confidence
and the model's promise to ignore identifiers cannot prove the boundary.

Require a trusted, local-to-the-isolation-boundary parsing/redaction stage before
any provider access, with strict document-format support and independent adversarial
evaluation. This changes doc 05's no-local-OCR/raw-vision assumption and therefore
is approved for local implementation; hosted/real-content activation is not. Unknown formats, encrypted
PDFs, malformed input, uncovered regions, OCR uncertainty, embedded files, unparsed
metadata, barcodes/MRZs and unsupported identifiers fail closed into human review.
Until that stage is proven, **all arbitrary document-to-model egress stays closed**.

Names and addresses are not universally identifier-grade under ADR-007, but that
does not authorize sending them now. The initial boundary permits no free text,
filenames, paths, URLs, metadata, images, OCR text, last-four identifiers or document
bytes to a provider. No model or embeddings SDK/client is added. The synthetic local
stub uses only a fixed public fixture projection; it is not an extraction model.

## Scanner seam and isolation

The web module is a supervisor/contract only, never a document parser. It accepts an
immutable quarantined byte snapshot, computes its hash, binds one request nonce and
validates a bounded strict reply. Only clean, exactly bound, type-matching replies
produce a process-local receipt. Serialized or forged objects cannot be promoted.
Clean scan is **not redaction, processing, safe download or authority to write an
item/obligation**. An authenticated compromised scanner returning plausible false
clean output is beyond protocol validation; engine/isolation evidence is required.

The approved future scanner must run outside the web/request process with:

- no tenant DB, KMS decrypt, model, payment or general cloud credential;
- one sealed input snapshot via broker-owned pipe/read-only mount; no URLs or
  credentials in command arguments; no original filename/environment inheritance;
- no network, read-only root, non-root UID, all capabilities dropped, no privilege
  escalation, bounded tmpfs, file/process/open-file limits and enforced CPU/memory;
- a pinned, reviewed antivirus engine/database, magic-byte sniffing and format
  triage before parsing; no shell or executable selection from document input;
- watchdog hard kill/reaping of the full process group after deadline, bounded stdout
  and discarded stderr, no payload logs, one attempt per invocation. Durable retries
  belong to the job state machine, capped at three after an explicit reviewed budget.

The initial synthetic contract limits were 25 MiB input, 1 KiB reply and 5 seconds; the measured local scanner continuation below supersedes that execution budget. The separate
synthetic child has a 32 MiB Node heap and no inherited environment (only fixed LANG and NODE_ENV).
That child validates only a literal public fixture. Heap flags and a separate process
are **not** OS sandbox, RSS/CPU, network or filesystem isolation proof. Production
scanner port and activation remain absent. The current 60-second ADR-017 lease was
derived for DB-only work; do not attach scanning to it without a new execution budget.

## Durable dispatch/reconciliation

One invocation selects an explicit household/scope, refuses routing corruption,
routes at most 50 intents and sends at most one delivery. It never repairs unknown,
missing, unexpected or orphaned work. Existing transactional outbox, per-consumer
delivery leases and inboxes own durability. Lease/retry timestamps use database time;
send outcome checks expiry after acquiring its row lock. Host clock skew or time
spent waiting on a lock cannot prolong ownership. Send outcome requires the same
unexpired lease; ownership loss is an ambiguous result, not success. A later retry can duplicate
transport delivery, so the domain effect/inbox must still commit atomically.

An orchestrator must turn bounded status/counts into existing fixed observability
metrics without logging household IDs, payloads, object paths, receipts or errors.
No scheduler, continuous worker, new escape hatch, credential or deployment follows
from the local invocation seam. Retained deleted-household intent is observable but
must never re-enter active discovery/processing.

## Deletion coverage and receipt limits

Deletion authority must be owner-authenticated, with explicit confirmation, a 14-day
undo period and a durable request/fence that blocks new intake/provider work. It must
precede collecting a manifest and issuing any external delete. Provider I/O occurs
outside tenant transactions. Persist idempotent per-resource attempts and independent
absence verification; never interpret a successful DELETE/empty queue alone as proof.

Required coverage includes:

| Domain | Required evidence / limitation |
| --- | --- |
| Documents and derived data | Exact original/processed objects, all versions/copies, chunks/embeddings, items/obligations and source links |
| Quarantine | Incoming, selected sealed and unselected race/orphan copies; incomplete multipart cleanup and independently verified namespace absence |
| Identifier secrets | Ciphertext and wrapped keys removed; no decrypt during deletion |
| Notifications/reminders | Pending deliveries fenced; rows/provider references removed; suppression exception disclosed separately |
| Outbox/delivery/inbox | Cancel/fence first; erase payloads and receipts only after replay horizon/consumers are safely retired; no deleted-household resurrection |
| Job artifacts | Temporary files, exports, dead letters, storage artifacts and signed-capability expiry |
| Account/household | User/profile/memberships/members/preferences/idempotency responses; account deletion has broader scope than household deletion |
| Providers | Plaid Item removal/custody/derived records; Stripe subscription/cancellation/retention; email/analytics/error/model trace erasure where applicable |
| Audit | Account-scoped audit erased unless an explicitly authorized, bounded security-incident hold applies; minimal deletion evidence retained without content |
| Backups | Actual verified expiry/reconciliation, up to the documented 35-day ceiling; online erasure does not imply backup erasure; restore must replay deletion fences |

The local evidence assessor is a **completeness/freshness checker**, not an authority
to delete and not proof that provider observations are authentic. It distinguishes
online absence, remaining/unknown resources and time-bounded retention. It cannot
issue a final deletion receipt until a durable journal, authenticated observation
provenance, full account-vs-household coverage and independent verification exist.
The durable journals described below are local-only. Final completion remains denied; no provider/backup proof or final receipt is fabricated.

## Provenance and synthetic gate

The deterministic local path recognizes one exact public fixture after a bound scan.
It projects closed fields with a page citation and a content hash; no document string
or mutable caller metadata is passed through. Unknown/modified bytes fail closed.
The local stub never has a provider transport. Synthetic provenance cannot authorize
an actual item, obligation or notification. Real extraction needs validated citations,
human correction/review, secret write-only custody, and a reviewed state transition.

## Acceptance and activation prerequisites

Negative controls must defeat nonce/hash/type/size/reply checks, lease fencing,
missing fan-out, deleted-household discovery, incomplete deletion coverage and
synthetic-content allowlisting. Verify real RLS as restricted roles and preserve the
native toolchain. Before hosted work: select and
review the OS sandbox/engine/parser, prove egress denial, implement durable scan and
deletion journals with reviewed migrations, safe write-only secret custody and
restore handling, then authorize a synthetic-only deployment separately.

No current claim of real malware detection, redaction accuracy, complete deletion,
full-stack readiness or Production readiness. The new local migration must not be rolled back by deleting active fences/evidence. Disable invocations and preserve journal rows; revert application consumers independently. No hosted schema or provider resource was changed.


## September 20 approved local implementation

The provider-neutral OCI broker in `scripts/scanner-sandbox.mjs` creates a container
using a digest only and `--pull=never`. It inspects effective settings before stdin:
UID/GID 65532, no network, read-only root, no host mounts, no capabilities or privilege
escalation, 1 CPU, 1.5 GiB memory with no additional swap, 16 PIDs, 64 descriptors,
64 MiB noexec/nosuid/nodev tmpfs, no logs/healthcheck/restart and a fixed minimal
environment. Image labels must match the reviewed engine/signature digests. Labels
are a binding check, not proof that an engine actually implements those versions.
The independently reviewed release image/engine/signatures are not selected yet.

The entire invocation is bounded to 5s plus 2s container cleanup. Any cleanup
uncertainty refuses a result. The CLI uses a fixed binary/socket, no shell, a minimal
environment and process-group SIGKILL. Effective-setting negative controls pass,
but the local Docker engine times out: **Linux enforcement, actual engine behavior,
RSS/CPU/PID exhaustion and descendant termination are unproven**. This is contract
and lifecycle proof, not a deployed scanner or malware-detection claim.

Migration `20260920000000_document_security_journals` adds six forced-RLS journals,
three separate NOLOGIN/NOBYPASSRLS roles and audited raw-SQL transitions. Document
workers may update narrowly scoped document state and emit outbox intent; the
hostile scanner has no database connection. Retention workers cannot append absence
evidence or delete arbitrary domain data. Verifiers can count opaque local links
and append observations, but cannot rewrite evidence or finish deletion.

Scan identity is bound to household/document/sealed-object/hash/size. DB-time leases
last 30s and permit at most three attempts. This covers a 5s snapshot-load deadline,
5s scanner deadline, up to 2s cleanup and bounded DB work with margin. It is a local
journal budget; the existing ADR-017 SQS DB-only execution budget is unchanged.
No scanning is added inside an inbox transaction or hosted queue worker.

The deletion journal stamps an owner-authorized request and 14-day undo deadline.
A shared advisory lock serializes the mature fence with domain writes. Fences block
intake admission, scan advancement, dispatch and inbox effects. Previously issued
storage capabilities or in-flight network effects cannot be recalled by a DB flag:
a 15-minute settlement interval and subsequent re-inventory are mandatory, and
provider-specific reconciliation remains unfinished. Twelve coverage classes must
be represented before sealing a manifest. Coverage count is not inventory-completeness
proof. Resources and attempts remain content-free; acknowledgements never become
absence evidence. Only wholly local classes may be observed absent from DB counts.
Empty document rows do not prove storage erasure. Synthetic observations are labeled
synthetic; provider/backup adapters are not implemented. Final receipts stay disabled.

`services/ai` is a local, dependency-free runtime seam. The trusted parser recognizes
only a complete public synthetic record grammar, keeps the cited date/hash locally,
and refuses all additional or uncertain content. Redaction projects only fixed
version/task/kind enums. An unforgeable, single-use process-local capability gates
the deterministic stub; JSON, scanner results and parsed handles cannot bypass it.
No raw content, date, identifier, last-four, filename, source hash, tenant ID, URL,
metadata or provenance reaches the stub input. Compiler negatives and runtime
adversarial tests enforce this narrow interface. It is **not a real PDF/OCR parser
or production redaction guarantee**. No service is deployed and no model SDK or
network transport exists. A full synthetic intake-to-erasure lifecycle waits for
actual sandbox/engine proof and reviewed parser coverage, rather than treating these
independent component tests as a completed lifecycle.

See [local implementation and verification report](../../engineering/adr018-local-foundations-20260920.md)
for migration lock/size/rollback analysis, exact tests and unresolved activation gates.


## Local real-scanner continuation (September 20)

[The continuation report](../../engineering/adr018-local-scanner-continuation-20260920.md)
records the official pinned ClamAV 1.4.6 image/signatures, actual Docker Desktop
Linux probes and measured 20–28s scans. The local-only bound is now 3GiB/40s plus
5s cleanup, with a distinct 90s DB-time scan lease. ADR-017 worker timing is unchanged.
Protocol v2 binds the durable nonce, bytes/type and engine/signature/sandbox digests.
AV-clean content outside the complete canonical public PDF subset is indeterminate.
The typed projection still emits fixed enums only; no provider is called.

Manifest- and live-component-lease-bound local row deletion and synthetic file
absence observations are added. Four composite tenant-reference checks protect
document/derived/reminder edges; valid same-household referential actions remain.
Provider-linked notifications, identity, outbox/inbox/scan-history retirement, backup
expiry and authenticated independent restore-ledger proof remain incomplete. The
restore gate refuses activation without that authority; final receipts remain false.
The composed local proof uses simulated review and local queue transport, not a
product/stable-staging lifecycle. These developments do not authorize hosted activation.
