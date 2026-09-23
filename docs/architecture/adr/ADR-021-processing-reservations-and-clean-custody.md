# ADR-021: Local processing reservations and separate clean custody

**Decision: new ADR required; approved for bounded LOCAL synthetic implementation
after principal review, September 21, 2026, under the founder's continuation mandate.**
This does not authorize storage infrastructure, hosted rollout, real documents or a
product retention promise. ADR-016's seven-day hostile quarantine is unchanged.

## Decision and charge point

Charge one document only when successful processing completion and its durable result
reference commit. Upload, clean scan, parsing start and provider start do not themselves
consume processed usage. A reservation consumes available capacity until resolved;
completed rows are the usage ledger, never a mutable/resettable counter. No retry can
create a second ledger row for the same immutable document. Scan-clean is neither
redaction clearance nor a processing/model permission.

## State separation and trust

Upload admission has an independent outstanding-object/byte budget before accepting
bytes. Quarantine remains hostile and short-lived. A verified clean scan allows an
immutable copy into **separate clean custody**, never a longer quarantine lifetime.
The copy journal is written first, exact bytes are copied outside the transaction,
then verified and marked ready. A crash leaves a reconcilable `copying` entry. No
deleting source/losing accepted bytes to make a journal appear consistent.

The local broker uses the existing `app_document_worker` authority and transaction-local
household scope, adding only read-only plan/eligibility columns and two scoped journals.
It is trusted to attest its copy/result; SQL cannot prove filesystem or parser truth.
The scanner process still has no DB/provider authority, and the model-facing stub
receives only the approved ADR-018 capability, never custody paths, bytes or DB handles.
No new privileged principal, SECURITY DEFINER, model SDK or hosted invocation.

New journal guards bind household/document/clean scan/object UUID/hash/size. Binding
is immutable, every transition audited, raw result text and provider payloads excluded.
An opaque result UUID is a local publication reference, not a claim of semantic accuracy
or valid obligation provenance. Actual result publication must separately enforce
ADR-018 redaction, citation and human-review rules before domain effects.

## Reservations, periods and bounded ambiguity

Acquire the existing privacy lock then the household quota lock. Read effective plan
from PostgreSQL time, catalog version and reconciled billing revision. Reserve only
if completed + held slots are below the current limit. One reservation identity per
custody/document prevents replay charges. Waiting documents consume storage, not usage.
Reservation lease is 90 seconds for the local synthetic execution seam; it is not a
budget for hosted extraction. Do not start during the last 90 seconds of a UTC month.

Before starting and completing, recheck the exact period, plan/catalog/billing revision,
grace/paid-through eligibility, deletion fence and custody state. A changed plan does
not silently authorize old work. A reservation that has not started can safely return
to waiting after expiry; at most three claims, then terminal `failed`, never an
unserviceable waiting entry. Once started, a timeout/crash/provider
ambiguity becomes `indeterminate`, retains its slot in its original period and must
never automatically invoke a provider again. Deterministically failed local parsing
has no charge, but exhausts that document rather than enabling unlimited retries.
Successful completion must occur within the reserved UTC month and live lease. A
cross-month result is held for reviewed reconciliation, never charged to the wrong
month or rerun automatically. No host-clock authority or billing-cadence reset.

This conservative local boundary may strand a valid result at a period/plan transition.
A later result-reuse reconciler needs explicit evidence of no repeated provider work,
new period capacity and retained provenance; it is not silently implemented here.
Separate processing-cost/work budgets are required before any real provider activation.

## Pending custody policy and ordering

Local synthetic bounds: 20 outstanding custody objects, 500 MiB total, 25 MiB each,
35-day **review deadline**, FIFO by DB-created timestamp and UUID, one claim per
bounded household invocation. These are engineering test limits, not a new published
Free/Premium product allowance. All retained states count toward storage admission,
including ambiguous, failed, completed and cancelled objects until absence is verified.
Downgrade cannot delete, archive or free their storage slots. Duplicate object/hash
bindings cannot gain extra work. Per-household invocation avoids an unscoped fair queue;
hosted cross-household scheduling remains separate.

Deadline expiry means `held`: stop processing, expose action-required, preserve bytes,
and block further admission if bounded capacity is occupied. **No automatic deletion
or silent indefinite processing queue.** Hosted pending count/bytes, deadline,
notification cadence and the user's eventual retain/export/delete decision require
recorded product approval before activation. Local tests exercise the refusal state
without inventing that approval. No expiry promise is shown to real users.

Upgrade/rollover permit the next waiting document on the next bounded invocation;
there is no continuous worker or unbounded next-month retry. Downgrade/grace expiry
preserve data and prevent new over-allocation. Cancellation stops future work but
does not imply object erasure; independently observed absence is required. Deletion
fences processing before inventory/copy/result commit; outstanding effects require
settlement and reconciliation under ADR-018/019.

## Privacy, export and eventual storage

Local custody is a separate private synthetic directory with immutable server-owned
UUID paths, exclusive creation, byte/hash binding and no URL generation. Root/file
symlinks and unexpected bindings fail closed. Local fsync and readback are not cloud
durability, backup erasure or protection from the same OS owner. Exact absence is
observed separately from unlink acknowledgement. Pending status is exportable; raw
originals/identifiers remain omitted until a reviewed reveal/archive path exists.
Both journals belong in privacy inventory, restore/retention coverage and RLS tests.
They RESTRICT parent deletion; final receipts remain false and ADR-019 unactivated.

Any eventual cloud custody needs its own saved plan and authorization: separate
private encrypted storage, TLS, exact temporary broker roles, no model/scanner cloud
credential, no query-signed download/overwrite, no public cache, and audit/metrics/log
destinations encrypted and content/capability-free. Plan S3 access logging, CloudTrail
data events and bounded metrics without logging signed URLs or original filenames.
Do not repurpose the existing quarantine upload role/bucket or change its lifecycle.

## Review outcome and implementation gate

Rejected: increment on upload/scan/start; extend quarantine; release started work on
lease expiry; count provider event arrival; charge a new period implicitly; auto-delete
over-cap documents; treat a filesystem success as independent erasure evidence.
The smallest local design is two forced-RLS journals and SQL admission/transition guards,
with no persistent new credential. The upload prototype now reserves its independent storage budget before returning any
upload capability; signing occurs outside the transaction and an unadmitted capability
is never returned. Historical upload counts still require explicit reconciliation.
Migration 28 refuses any nonempty document inventory **or nonzero legacy usage**,
even if historical documents are already absent: historical upload charges cannot
be silently converted to processed usage. This is a cutover gate, not a hosted migration
plan. The prototype remains disabled pending the complete custody/processing composition.

Migrations must set 5s lock/60s statement limits, leave old counters/history intact,
and add indexes on new empty journals. Rollback disables invocation, retaining custody,
reservations, charges and audits. Never turn completed/ambiguous work back into waiting.
Measure row/index width, state assumptions at 100k households, and retain full native
and restricted-role concurrency/mutation evidence. Cost arithmetic is a scenario,
not workload/capacity proof; $1.10 target/$1.60 red line remain unchanged.

## Cost scenario and scale review (September 21, 2026)

At 25 MiB per document, one copy held for a full month, 100,000 identical households:

| Scenario | GiB/household | Total GiB | S3 Standard storage/month |
| --- | ---: | ---: | ---: |
| Free: 10 documents | 0.24414 | 24,414.06 | $561.52 |
| Premium: 50 documents | 1.22070 | 122,070.31 | $2,736.75 |
| Local pending bound: 20 documents | 0.48828 | 48,828.13 | $1,123.05 |

Arithmetic uses the [Ohio public AWS price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-2/index.json),
publication `2026-09-18T17:47:47Z`: $0.023/GiB-month first 50 TiB, then $0.022
through 500 TiB. [S3 pricing](https://aws.amazon.com/s3/pricing/) specifies binary
GB. Source SHA-256: `5f59fb690b2cabb25076254e611686b415a3adb66ef7fda60e398f7f16f14e33`.
No free tier/credits assumed. This is **not measured capacity or a provider bill**.
Premium's 50-document scenario exceeds the local 20-retained-object bound: it models
monthly throughput with reviewed retirement/archive capacity, which is not implemented.
The 20-object local bound must not be advertised as a new paid-plan promise.

Seven-day quarantine adds roughly 7/30 of one monthly arrival copy, plus sealing
orphans/retries. Requests, scanner/worker CPU, model work, network, logs/CloudTrail,
metrics, DB/indexes/backups and support remain unpriced. Archive accumulation and
held-review objects are not bounded by monthly document allowances. Hosted retention
and measured cost are gates. Nothing here proves the existing $100 staging budget.

Before all other COGS, $1.10/household permits at most $0.11 per Free document or
$0.022 per Premium document at full allowance; $1.60 red line permits $0.16/$0.032.
These ceilings are not available model budgets: subtract all other COGS first.
100k households at 50 completions/month creates five million ledger entries/month.
No automatic ledger purge is authorized; reviewed archival/usage-proof retention is
required before hosted scale. New indexes build on empty tables. Existing inventory
constraint validation scans its existing table under bounded locks; large installations
must measure that scan and abort on timeout. Additive `queued` enum rollback leaves
the label present and disables callers, rather than destructively rewriting history.

## September 21 result/publication amendment — local principal review

**APPROVE WITH REQUIRED AMENDMENTS for synthetic local execution only.** A random
result UUID is insufficient. Add an immutable closed result journal bound to the
existing custody, processing identity, original lease/period/revision, clean scan
attempt and engine/signature/sandbox release. The trusted broker parses the exact
canonical public PDF with ADR-018, calls only the single-use local enum stub, and
records its hash, fixed parser/redactor versions, one bounded page/byte citation and
public fixture date. No arbitrary text/JSON, filenames, paths or identifiers enter
the journal. SQL verifies identity and release bindings; it cannot independently
prove a compromised broker parsed bytes honestly. The scanner/model receives no DB
or credential authority. Unknown content fails before any artifact is admitted.

Artifact creation and charging are separate. An artifact can be retained after a
lost response/expired started lease, bound to the ORIGINAL invocation, without
retrying provider work. A unique processing identity refuses competing artifacts.
Review is an immutable separate owner-attributed row. The local owner gateway creates
one cited synthetic item/obligation and review, completes the ledger and emits exactly
one processing intent in the SAME transaction. No automatic approval, no real-content
route and no hosted activation. Domain writes are rolled back if charge authority
fails. The ordinary application may complete only a broker-attested reviewed result;
it cannot create artifacts, reserve/start work, choose a charge month or edit usage.
The document worker cannot fabricate owner review or write items/obligations.

A reviewed result may be reused within its original UTC month: under the privacy and
quota locks re-read effective plan and revision, count completed/held slots excluding
its own original slot, require capacity and ready custody, then stamp the NEW accounting
revision while retaining the ORIGINAL revision in the immutable result. This permits
upgrade/cadence changes and spare-capacity downgrade/grace transitions without another
parse/provider invocation. A completed response replay returns the original domain
IDs and cannot create another charge. Old-period results are retained and reported as
held; this amendment expressly does NOT charge a later month or authorize retroactive
charging. Cancellation, deletion fence, custody deadline, unknown provenance, lost
ownership and over-cap downgrade refuse publication without discarding the artifact.
Unstarted lease expiry still follows the existing three-claim bound.

Two new empty forced-RLS journals use exact column grants, no role/SECURITY DEFINER.
Bounded 5s locks/60s statements; validate existing references without rewriting history.
Existing completed legacy rows remain historical; new completion requires the journal.
Rollback disables invocation and retains results/reviews/charges. Privacy inventory
includes both journals. Restrictive references deliberately prevent premature cascade
and final receipts remain disabled. No content-erasure/restore authority is implied.
At 100k households and 50 monthly documents, five million result/review pairs per month
require measured row/index/WAL/audit sizes and reviewed retention before hosted scale;
local validation is not a capacity result.

Follow-up source review requires immutable original storage path/hash/size/type once
custody exists, including writes from the ordinary application role. Its SQL check
acquires the privacy lock before reading custody, preventing registration/substitution
races. New result admission must atomically emit its exact `document.needs_review`
intent; owner approval emits both item/obligation intents with the charge. Failure,
retry exhaustion and started ambiguity project truthful document states and closed
outbox intents. These are additional invoker triggers, not new roles, credentials or
hosted activation. Migration 31 adds no rows/indexes or history rewrite; installation
locks are bounded and rollback disables invocation while retaining evidence/guards.

### Owner-visible local result resolution

A bounded owner/current-account read now classifies one immutable result using DB
clock, original period, custody state, deletion fence, current capacity and completed
review linkage. It exposes only IDs, period and a closed status; no bytes, hash,
lease capability or identifier. Display is not mutation authority. Reuse within the
original period still goes through the existing transactional review/charge guard.
Old-period evidence remains held and uncharged; the status requests a product decision
before any cross-period reuse/charge rule. No provider repeat, new-period charge,
cancellation or retirement is inferred from viewing the result. This local seam is
not mounted as an HTTP route or claimed as authenticated browser evidence.
