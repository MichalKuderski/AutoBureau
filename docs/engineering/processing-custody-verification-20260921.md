# Processing accounting and clean custody — local verification, September 21, 2026

**Production preflight: NO-GO.** This completes a bounded local foundation increment,
not the requested launch candidate or the full document/export/Plaid work program.
Tested implementation: `a88ace349e259ece92ba2cfc1720c2fc1d15962f`, isolated branch
`codex/review-pellum-hardening-v2`, worktree `/private/tmp/pellum-native-review-20260920`.
The final continuation commit changes documentation/evidence only; its exact SHA is
available in Git and the task's final response. Nothing was pushed, deployed, merged,
applied to a hosted database, or changed at a provider. PR #5 was not accessed/modified.

The starting clean HEAD was `05bf782d6bfa82283f4c52f296b3d22b62a31dbc`; its diff from
previously tested `722e0e9908c9e0f48831d624b4dac0fa12d26c1b` was documentation/evidence
only. All 386 inventoried original-checkout files still match their recorded hashes.

Local commits:

- `3c2bb8b`: ADR-021 principal review, cost assumptions and export compatibility review.
- `94a1574`: processing reservations, separate local clean custody, privacy inventory,
  partial export compatibility, upload-accounting correction and truthful queued status.
- `a88ace3`: reject legacy consumed usage even after historical documents are absent.
- Final documentation-only continuation: this report, evidence and risk/checkpoint updates.

## Architecture and authoritative charge point

**Decision: new ADR required.** [ADR-021](../architecture/adr/ADR-021-processing-reservations-and-clean-custody.md)
was written/reviewed before local implementation under the founder's bounded continuation
mandate. It is not an approval of a hosted storage plan or a new published retention policy.
ADR-016 quarantine remains seven days. No hosted lifecycle/configuration was changed.

Usage is charged exactly once when successful processing completion, an immutable
opaque result reference and its transactional outbox intent commit. Upload admission,
scan-clean and processing start do not charge. The reservation/charge ledger, not the
legacy mutable entitlement counter, is authoritative for this local path. The old
counter remains historical data and is never reset by upload, cancellation or cadence.
An opaque result UUID is **not** proof of validated extraction/provenance; actual result
publication must still compose with ADR-018 citation, redaction and human-review guards.

Capacity uses DB UTC month, catalog version, effective tier and billing revision under
household privacy/quota serialization. Start and commit recheck lease, period, plan,
DB-time grace, custody and deletion authority. Old-period results fail closed. Expired
unstarted work retries at most three times, then becomes failed. Started uncertainty
holds its original slot and cannot automatically retry provider work. Parse failure is
uncharged but terminal. FIFO and one bounded household invocation avoid an unbounded
scheduler. Changes of plan/cadence may strand a result safely; reviewed result-reuse
reconciliation remains work, not an excuse to charge a new month or repeat a provider call.

## Custody, privacy and UI

The local adapter accepts only `PUBLIC SYNTHETIC <UUID>` text. It requires a private
separate directory, exclusive immutable object creation, exact byte/hash binding,
no symlinks/hardlinks, bounded reads and fsync/readback. Lost copy responses reconcile
against the same immutable object. Unlink acknowledgement is distinct from absence
observation; an inaccessible/missing root reports unknown. It generates no signed URL.
These checks do not establish cloud durability, backup erasure or protection against
a compromised broker/OS owner.

Local engineering bounds are 20 retained objects / 500 MiB / 25 MiB each. The upload
prototype independently reserves storage before returning a capability. Full storage
returns a conflict, without a capability or implied paid-plan upgrade. Every existing
record survives. A 35-day review deadline holds work rather than deleting it. These
are **local test limits, not ratified Free/Premium storage allowances**. Hosted pending
limits, notification/action handling and eventual retention choices need product review.
The 20-retained-object prototype cannot support indefinitely accumulated Premium archives.
Real intake remains disabled.

Both journals enter deletion inventory with minimal references. Restricted retention
and verifier roles reconcile populated sources but cannot read object/hash or lease/result
fields; foreign households remain invisible. Parent deletion is RESTRICTed while custody
exists. Journal retirement and allowance-preserving erasure reconciliation remain unfinished.
No final receipt is issuable; ADR-019 operational authority stays unactivated.

Partial snapshot v2 now carries closed document-work category v1. Existing v1/v2 artifacts
remain readable and disclose uncaptured categories. Originals, identifier reveal, arbitrary
content, complete audit/provider categories and ZIP remain omitted. See [the export review](export-custody-review-20260921.md).
The document list separates **Queued** from **Working**; scan-clean no longer claims that
processing has started. This is component coverage, not exhaustive authenticated browser,
mobile, keyboard or accessibility evidence. Detailed pending reasons, usage/warning/upgrade
views and complete status-to-publication composition remain local implementation work.

## Exact-candidate validation

| Check | Result |
| --- | --- |
| Frozen offline install | PASS; lockfile unchanged |
| Full build and typecheck | PASS |
| Lint | 0 errors; 13 pre-existing warnings |
| Units/regressions | 1,929 passed |
| Restricted-role PostgreSQL/RLS | 733 passed: 254 DB + 479 HTTP |
| Local infrastructure/acceptance controls | 199 passed |
| Architecture guards | 7 passed |
| Quota/custody targeted suite after mutations | 24 passed, included in DB total |
| Real isolated ClamAV synthetic lifecycle | 1 passed, separate from the new text-custody adapter |
| Deliberate security weakenings | 5 detected and restored |
| Historical cutover | Document inventory and usage-only cases both refused; fixtures rolled back |
| Original user files | 386/386 unchanged |

Pinned runtime: Node 22.16.0, pnpm 10.34.5, Next 15.5.22, TypeScript 5.9.3,
Vitest 3.2.7, Prisma 6.19.3, PostgreSQL 18.3, Stripe 22.6.2. Scanner digest/engine/signature
pins and all log SHA-256 values are in [machine-readable evidence](evidence/processing-custody-native-20260921.json).
ClamAV's existing 40-second / 3-GiB boundaries were not increased. Historical queued
failure causality remains unknown; later success does not resolve it. Install retains
pnpm's existing ignored dependency-build-script warning; explicit Prisma generation and
native builds pass. No dependency versions or lockfile were changed.

Mutation details, on the disposable database only:

1. Remove overlapping privacy/quota locks and FIFO admission ordering, add a deterministic
   concurrent-read delay: both final Free/Premium slots overbook. This tests the **combined**
   serialization boundary, not each redundant lock independently.
2. Remove the SQL allowance predicate: the same final-slot tests overbook.
3. Remove unique custody accounting identity (and adjust conflict-target syntax only for
   the experiment): a second accounting identity is accepted and the negative test fails.
4. Remove transition and commit period guards: old-month completion succeeds incorrectly.
5. Remove deletion-fence refusal, retaining its lock: fenced completion succeeds incorrectly.

Every control was restored and function/source definitions compared; the entire 24-test
quota/custody suite then passed. No weakened behavior is committed. These are specific
negative controls, not exhaustive fault tolerance or a compromised-runtime proof.

Earlier failures were retained rather than hidden: a sandbox unit attempt could not
bind synthetic loopback servers (EPERM); the permission-correct run passed unchanged.
The historical export fixture accidentally carried a new category into v1; corrected
fixture construction preserves strict old-schema rejection. A mutation harness first
referenced a nonexistent DB config, then assumed a PL/pgSQL terminator; both failures
restored controls and were corrected before valid mutation evidence. A second database
inside an existing cluster hit historical CREATE ROLE collisions; the final evidence
uses an entirely fresh isolated cluster. No historical migration was weakened to bypass it. The migration-gate fixture initially
omitted required timestamps; its transaction rolled back, and corrected fixtures prove
both document-inventory and usage-only refusal. The historical cutover counterfactual also detects the earlier missing usage guard.
Final review caught the latter cutover
risk; a focused follow-up commit strengthens the unreleased migration and the full
exact-candidate suite is rerun on another fresh cluster.

## Database and migration posture

Fresh isolated release endpoint: `127.0.0.1:55544/pellum_custody_final_20260921`.
29 completed migrations; 0 unfinished/rolled back; every checksum matches source.
35 forced-RLS tables, 48 policies, 26 privacy fences, 14 journal audit triggers.
No ensure_rls trigger, provider table grants, runtime-owned tables, new SECURITY DEFINER
functions, new role membership or disabled user triggers. No new role was created by
this increment; document-worker additions are scoped journals and read-only plan columns.
Dedicated billing authority remains intact; generic job-worker billing grants remain zero.
Temporary restricted-role test passwords are cleared, roles return to NOLOGIN, and local
TEST activation returns to false. Fixture journals are empty after the final scanner proof.
The pre-existing reviewed dispatcher escape hatch remains; this is not a claim that every
historical role is NOBYPASSRLS.

Migrations create new empty tables/indexes and add the queued enum, with bounded lock and
statement timeouts. The accounting cutover refuses any nonempty document inventory or nonzero legacy usage; no
historical upload charge is silently converted/reset. Hosted migration therefore requires
an independently reviewed inventory/accounting plan. Rollback disables callers and retains
journals/charges/bytes; it must not turn ambiguous/completed work back into waiting. The
queued enum is retained on rollback. Row-width estimates and 100k-household cost arithmetic
are scenario evidence, not storage or throughput benchmarks; see ADR-021 and the evidence JSON.
`pg_column_size` measures 168 bytes for the synthetic custody composite and 192 for a
fully populated processing composite; the tables have six and three indexes respectively.
Five million row pairs imply about 1.8 GB of composite payload alone, excluding heap/page,
index, audit, WAL and backup overhead. No 100k-household workload was benchmarked.

## Remaining risks and exact next order

1. Complete the local end-to-end custody/processing composition: actual immutable result
   artifact/provenance publication, explicit pending reasons, monthly warning/usage view,
   result reconciliation across plan/month changes, and quota-preserving custody retirement.
2. Ratify hosted pending storage/retention/action policy; implement notification and retention
   reconciliation. Add cloud custody only through a separate reviewed saved plan/authorization.
3. Finish original/identifier export authority, archive/category reconciliation, and operational
   erasure/restore trust. Do not claim full export or issue a final deletion receipt.
4. Continue Plaid local encrypted custody, immutable owner binding, durable Item/account/inbox/
   cursor/sync/reconnect/removal state and privacy coverage. A distinct credential/runtime
   boundary needs its own ADR before implementation. Current Plaid transport/signature tests
   pass as regressions; **durable Plaid lifecycle remains unimplemented by this increment**.
5. Complete authenticated UI/accessibility matrix, reminders, recovery/privacy and full TEST
   billing lifecycle; obtain actual authorized Sandbox and exact-SHA stable-staging evidence.

Independent local work remains and is not blocked by Supabase. Three September 13 upstream
gateway 504s remain confirmed; deeper request-linked causality remains unknown. OAuth
replacement is established; historical management-token invalidation remains unproven.
Support packet **PREPARED BUT UNSENT**. No credential retries or Auth timeout increases.
Stripe remains TEST-only with ordinary activation disabled; Plaid Production and real accounts
remain closed. Legal operator/jurisdiction/public contacts, external provider evidence,
operational alert/cost evidence and separately approved rollout remain prerequisites.
The loopback preview is restored, with a landing-page HTTP 200 only; it is not authenticated
end-to-end evidence. Production, real data/model processing, DNS, merge, deployment and
public launch remain closed. Local validation does not change **NO-GO**.
