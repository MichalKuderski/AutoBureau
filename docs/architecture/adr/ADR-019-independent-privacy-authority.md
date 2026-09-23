# ADR-019: Independent deletion authority and bounded privacy evidence

**Status: APPROVE WITH REQUIRED AMENDMENTS, principal-security review, September 20,
2026.** The mandatory amendments below accept the architecture direction, not an
operational implementation or provider. The v1 local prototype is not a conforming
operational authority. This is a new trust authority, not covered by ADR-018 approval.
No hosted authority, key custody, restore activation, automatic evidence purge or
final deletion receipt is authorized by this proposal.

## Problem and governing constraints

A database restored from before a deletion cannot establish that no deletion took
place. A local unsigned tombstone directory can refuse activation, but cannot prove
completeness or freshness. Founding Principles §7.10 requires truthful export/deletion;
ADR-018 requires independent observations and fail-closed restore reconciliation.
An old signed snapshot is also insufficient: authenticity is not freshness.

## Proposed trust model

The [principal-security review](../../engineering/adr019-security-review-20260920.md)
is normative for the following amendments. If an older proposal paragraph is less
strict, these requirements win.

### Mandatory amendments before any operational implementation

1. **Independent admission, enrollment and inventory.** An authority-controlled
   registry records opaque account/household incarnation IDs and their relationships
   before serving is possible. Restored DB membership, UUIDs and lists cannot establish
   completeness or enrollment. A restore manifest bound to the exact backup and full
   restore scope must be checked against that registry. Unknown, omitted, renamed,
   detached or conflicting subjects quarantine the entire affected scope. An admission
   gate outside ordinary application deployment authority controls database/storage
   egress and user traffic; a compromised application must not bypass a boolean result.
   Household-only deletion does not delete an account; account deletion covers every
   independently registered household and blocks new enrollment for that incarnation.
   Re-creation uses fresh IDs and never clears an old tombstone or attaches old data.

2. **Deletion is monotonic and deny-only.** Authorized writers can append deletion
   intent/tombstones, never rewrite deleted to active. An active response means only
   no tombstone in a complete, current, authenticated registry, not permission to
   resurrect. Separate enrollment, tombstone, hold, admission and key-administration
   identities. A deletion-worker or signer credential alone cannot assert active state.
   A compromised tombstone writer may cause denial of service; it cannot resurrect.
   Unknown or missing records never default to active.

3. **Independent durable witness and control plane.** Require an atomic, durable
   monotonic checkpoint and tombstone set in a separate failure and administration
   domain from the statement signer/writer, app credentials, DB, backups and restore
   operator. Every accepted statement must be bound to a witnessed committed ledger
   state, not just a digest chosen by its signer. Quorum/consensus guarantees, complete
   registry reads, witness receipt verification and equivocation handling require a
   reviewed implementation. No homemade Merkle or consensus protocol. Losing quorum,
   checkpoint lineage, tombstones or the witness means quarantine. Collusion/compromise
   of every independent control plane is outside the guarantee and must be disclosed.

4. **Versioned protocol and lineage.** Operational v2 must use a reviewed standard
   canonical encoding (for example RFC 8785 via a reviewed implementation), explicit
   domain/version/authority/key ID, subject type and incarnation, restore-manifest
   digest and admission scope, challenge, ledger commitment, issuance/expiry and
   witness receipt. Use an ordered epoch plus sequence with independently witnessed
   predecessor lineage; an arbitrary new UUID generation cannot reset monotonicity.
   Tombstones survive epochs. Fresh one-use challenges and their consumption must be
   durable and shared across hosts. All fields, collection sizes and numeric ranges
   are bounded before expensive work. Standard Ed25519 verification authenticates
   bytes; it does not prove ledger completeness, non-equivocation or deletion expiry.

5. **Key lifecycle.** Non-exportable signing keys reside outside application/backup
   credentials. A separately authorized key registry binds key ID, purpose, epoch,
   validity and revocation. Rotation requires witnessed lineage and overlap policy;
   old signatures never bypass current revocation. Suspected compromise quarantines
   affected admissions since the last independently trusted checkpoint, revokes the
   key and re-reconciles against witness/tombstones using a replacement key. Previously
   valid signatures are not grandfathered into active status. Revocation freshness
   is mandatory even during disaster recovery. There is no app-controlled key fallback.

6. **Availability, partial and regional restores.** Inspection/repair can run offline
   with traffic, jobs and provider egress disabled. Serving requires a fresh, complete,
   witnessed reconciliation and a bounded admission lease. Recheck after any snapshot,
   scope, epoch or key change. Regions share one ordered authority, not independent
   last-write-wins ledgers. Partial restores include dependency closure. A deleted
   subset stays fenced; an omitted/unknown subset cannot be served. Authority failure
   or expired admission fails closed rather than extending the lease automatically.

7. **Minimal evidence and its own lifecycle.** Retain random opaque incarnation IDs,
   scope/relationships, monotonic tombstones, minimal ledger/checkpoint/key lineage,
   authorization/audit references and explicit holds. No emails, names, content,
   identifiers, provider references, object paths, tokens or plaintext request bodies.
   Pseudonymous IDs/relationships remain personal data, with access audit and purpose
   limitation. Tombstones cannot expire while any restorable or replay source remains
   unretired. Evidence loss is unknown, never active. Authority backup/replication uses
   separate custody and anti-rollback recovery. Its own retirement requires verified
   retirement of every dependent copy and admission, plus independent hold clearance;
   absence of that proof means retain only the minimal suppression record, disclose
   the limit, and refuse final erasure claims. No arbitrary permanent audit exemption.

8. **Operational acceptance.** Before selecting hosting, specify identities/permissions,
   custody, replication/quorum, backup restore and anti-rollback drills, read availability,
   hold creation/review/expiry, break-glass dual control, incident response, cost, and
   audit retention. No ordinary app, tenant role, deletion worker, backup operator,
   payment/model/financial provider or shared deployment credential may change witness,
   keys, enrollment or admission policy. No destructive journal retirement or final
   receipt follows from this review. Their operational authority/hold implementation
   and evidence remain separately gated.

The existing v1 verifier remains explicitly local and non-activating. Its fixed-key
signature, nonce and injected checkpoint tests do not satisfy amendments 1–8, and
must not be exposed as an operational restore approval endpoint.

Use an authority outside the application database and all its restore snapshots.
Its writer is distinct from application, scanner, deletion executor and verifier
roles. A delete becomes irreversible only after the independently authenticated
household/account tombstone is durably accepted. Failure leaves processing fenced.
Account and household scope are explicit; account coverage includes independently
verified household membership, never an untrusted list supplied by a restore.

The local prototype uses ephemeral Ed25519 keys, exact configured public-key trust,
strict canonical typed messages, a fresh challenge, a five-minute maximum response
lifetime, exact subject-set binding, and a monotonic sequence/hash checkpoint outside
the restored snapshot. Challenge use and checkpoint advancement use a one-use challenge plus an atomic checkpoint port.
The local test implementation also refuses deleted-to-active resurrection at a higher
sequence; accepted tombstones must survive checkpoint generations. The port itself
does not supply a durable store. Its invocation is single-attempt with a five-second
abort/deadline, immutable verified input and an expiry recheck after commit. An
ambiguous late checkpoint commit never authorizes serving or triggers an automatic retry. Missing/unknown subjects, old versions, equivocation, unavailable
checkpoint authority and invalid signatures refuse reconciliation. No arbitrary
metadata, payload, email, provider reference, secret or source path is signed.

A successful local verification authorizes only a bounded reconciliation decision:
which known opaque subjects must stay fenced. It does NOT authorize serving traffic,
prove external backup expiry, mint a final receipt, or establish that the supplied
restore inventory is complete. Activation additionally needs an independently
verified complete restore inventory, durable cross-host checkpoint/challenge storage,
writer authentication/key-rotation/revocation, and an operational restore runbook.
A database dump must never contain the authority's signing material or checkpoint.

Retention of a minimal opaque tombstone is necessary until every restorable copy and
replay source is independently retired. Do not invent a deadline that makes missing
provider/backup evidence disappear. Hosted retention/erasure of this authority needs
an approved lifecycle and security-incident hold policy; unknown holds fail closed.
The local prototype is not that external operational evidence.

## Replay and journal retirement proposal

ADR-017 stages Standard queues with seven-day main and fourteen-day DLQ retention.
[The SQS documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
keeps the original enqueue timestamp when a Standard message enters its DLQ.
Manual redrive or re-publication can create a new delivery lifetime. Queue age alone
therefore does not authorize erasing domain deduplication state.

For an irreversibly fenced household only, retain outbox/delivery/inbox through at
least fourteen days after capability settlement, and refuse any active send/receive
lease. Preserve the independent tombstone and permanent application fence so even
manually replayed envelopes are refused. Do not apply this rule to active households.
A separately controlled security hold blocks retirement. The implementation must
remove leaf inbox/delivery rows before parent outbox rows, bounded by actual affected
rows, write count-only evidence atomically, and independently re-read retained state.
It must not grant audit deletion or remove the deletion journal/fence.

Scan-journal retirement is distinct: no document/active scan may remain, every lease
must expire, and a seven-day post-settlement diagnostic interval is proposed for
synthetic/local jobs. Three bounded attempts and a 90-second scan lease do not
justify indefinite per-document hash/nonce retention. Incident holds override this
interval. Seven days is an engineering proposal, not established provider policy.
No real journal purge should activate until this policy and holds are approved.

## Inventories and exports

Use bounded, deterministic keyset pages with household/request/source-bound cursors.
Do not use a page count or twelve coverage-class entries as proof of a complete
inventory. Reconcile source rows against manifest references, detect missing/extra
entries and changed counts, and make duplicate page replay idempotent. Reconciliation
must inspect in-flight leases and fail closed on unknown routes or omitted scopes.

Exports are owner-authenticated and scoped, exclude secret ciphertext/keys, provider
credentials, transport capabilities and internal implementation journals. A partial
safe JSON record export must identify its omissions; it is not the promised complete
originals + JSONL + audit ZIP. Artifact authority expires within 72 hours and must be
revoked by a deletion fence. Original files/identifier reveal need separately reviewed
access paths, never a bulk dump of encrypted secrets or arbitrary attrs.

## Consequences and approval needed

The extra trust plane and hold/retirement policy need explicit architecture approval
before activation. No cloud vendor or credential is selected here. Local contracts,
synthetic signatures, replay/rollback/forgery controls and bounded reconciliation can
be tested independently without claiming hosted authority or complete privacy delivery.
The next approval packet must state writer identity, key custody, independently durable
checkpoint store, complete inventory source, rotation/revocation, tombstone retention,
backup-provider evidence, incident holds, cost and failure-recovery procedures.

## September 21 retirement-dependency continuation

The [class catalog](../../engineering/journal-retirement-catalog.json) classifies every
current journal family, including future Plaid, with purpose, personal/content scope,
replay/accounting/restore dependencies, bounded incident review and final removal
conditions. Opaque identifiers/hashes remain personal data. A hold deadline expiring
is UNKNOWN, not clearance. No numeric permanent retention policy is invented.

The local closed review contract admits at most 100 entries per operation and returns
blocked or ready-for-independent-review. It grants no purge capability; final receipts
and operational retirement remain false even when synthetic dependencies are closed.
A database-local closure flag cannot substitute for independent ADR-019 witness/hold
clearance. Existing bounded manifest/attempt leases can schedule inspection but cannot
authorize new journal DELETE grants. Until that independent boundary exists, preserve
accounting/replay/suppression evidence and report it as retained, not erased.

Independent local absence observers must count results/reviews, custody, processing,
export and billing journals immediately when those models exist. No parent cascade or
empty domain-table count may hide them. This correction changes evidence, not deletion
authority. Actual content-free accounting/suppression transfer and destructive journal
retirement remain separate local implementation work; no operational authority is
activated by the dependency evaluator.
