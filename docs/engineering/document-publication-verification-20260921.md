# Cited document publication and quota reconciliation — local verification, September 21, 2026

**Production preflight: NO-GO.** This is a verified local document-publication increment,
not completion of the full document/privacy/Plaid program or a staging release candidate.
Tested implementation: `1ed927d4737469c305f2888490a8c61cc922ddc7`, branch
`codex/review-pellum-hardening-v2`, worktree `/private/tmp/pellum-native-review-20260920`.
The subsequent continuation commit changes documentation/evidence only; obtain its exact
SHA from Git or the task's final response. No push, PR #5 access/mutation, merge, workflow,
deployment, hosted migration, provider mutation, Production access, real financial data,
real sensitive documents, external model call, DNS change or support submission occurred.

The starting clean HEAD was `29e9fde111b0d24ad63ddffddf36a380c8322c78`. Its changes since
previously tested `a88ace349e259ece92ba2cfc1720c2fc1d15962f` were documentation/evidence only.
All 386 inventoried original-checkout files still match their recorded SHA-256 values.

Local commits:

- `daaf626`: ADR-021 publication amendment, ADR-022 credential review, pending policy and export review.
- `4a9fe00`: immutable results/reviews, authoritative quota view, composed synthetic lifecycle.
- `477e0bf`: isolated ephemeral synthetic Plaid envelope-encryption seam and transplant tests.
- `b3aa183`: immutable custodied source, transactional review intent and truthful failure/ambiguity states.
- `1ed927d`: explicit household-incarnation encryption binding and non-vacuous transplant test.

## What the document proof establishes

One canonical **public synthetic PDF** passes actual upload admission and sealing gateways
with a local storage adapter, immutable byte snapshot, real isolated pinned ClamAV,
separate clean-custody copy/hash readback, DB-time reservation/start, the ADR-018 bounded
parser/redactor and single-use local enum model stub. It produces an immutable result,
requires explicit current-owner approval, creates one cited item/obligation, charges one
processing unit and commits the related outbox intents. Eleven scoped local deliveries
are reconciled: upload 1, scan 1, review 2, processed 2, item 2 and obligation 3. This proves
local dispatcher fan-out/delivery recording, not actual reminder/email/provider consumers.
Replay returns the original domain IDs without another parse, item or charge.

The result journal binds household, processing/custody/document/object IDs, SHA-256,
clean scan attempt and engine/signature/sandbox release, fixed parser/redactor/schema,
bounded page/byte citation, public fixture date, original lease/UTC period/tier/catalog/
billing revision and immutable review state. No arbitrary OCR, filename, path, credentials
or identifier text is stored. A separate immutable review records current owner and domain
IDs. SQL cannot independently prove that a compromised trusted broker honestly parsed
bytes; that trust and operational-isolation limitation are explicit in ADR-021.

The ordinary application cannot mint artifacts, reserve/start work or choose a charge
period. The document worker cannot create owner review or authoritative domain rows.
An old UUID-only completion is now refused. Source path/hash/size/type become immutable
once custody is registered; the check takes the shared privacy lock before observing
custody. Result admission requires its exact review outbox intent at transaction commit.
Parse failure/exhaustion is displayed as failed; expired started ambiguity requires review
and never silently retries provider work. Public/live intake and hosted workers remain off.

## Accounting and remaining reconciliation limits

Upload, scan and start never charge. Completed ledger rows charge exactly once in their
original PostgreSQL UTC month. Current effective plan/catalog/revision and available slots
are rechecked under privacy/quota locks during reviewed reuse. Original artifact accounting
bindings remain immutable; successful settlement records the current accounting revision.
Upgrade, cadence change, downgrade with capacity, grace/expiry, lost result acknowledgement,
duplicate approval, cancellation, custody deadline and deletion fence are exercised.
Over-cap downgrade preserves data and refuses additional charge. Historic usage is not reset.

Old-month results remain held and uncharged: they are not moved into the new month and
no provider work is repeated. The customer/operator resolution for those artifacts remains
unfinished. Bound expiration retry for **unstarted** work remains distinct from started
ambiguity. No actual model/provider success or external lost-commit scenario was invoked.

An authenticated, no-store quota endpoint reads DB effective plan, processed/reserved/queued/
processing/review/action-required counts, next UTC boundary and grace. Free 8/10 and Premium
40/50 warnings have component and restricted HTTP tests. Browser arithmetic is not authority.
The document screen distinguishes queues, processing and review; this is component/API
coverage, **not** authenticated browser/mobile/keyboard/contrast/text-scale/reduced-motion QA.
Pricing remains provisional $12/month or $99/year. The one-account-holder human-member
policy and dedicated TEST billing authority are unchanged; ordinary TEST activation is false.

## Pending custody, export and deletion

Seven-day hostile quarantine remains separate from clean custody. Local 20-object/500-MiB/
25-MiB-per-object bounds and the 35-day hold are engineering devices, not published plan or
retention promises. The exact hosted decision is isolated in
[pending-custody-policy-decision-20260921.md](pending-custody-policy-decision-20260921.md).
A retention deadline holds processing; it does not silently delete or retain/process forever.
Owner cancellation/UI, warnings, abandonment and old-period resolution remain unfinished.

The [export review](export-custody-review-20260921.md) requires owner/recent-auth/deletion and
immutable-binding checks for any future original builder; it rejects long-lived signed URLs.
Identifiers remain omitted by default. Full values need explicit category opt-in, independent
recent-auth/AAL2/audit and a narrow client-bound/write-only design. No generic worker decrypt
grant was added. Historical v1/v2 export readability remains unchanged; originals, identifier
reveal, arbitrary content, complete audit/provider categories and ZIP remain incomplete.

Privacy inventory includes populated result/review journals through content-free references.
Restricted verifier/retention roles cannot read their source hashes or retire them. The
composed proof fences work, deletes exact local quarantine/clean objects, and separately
observes local absence. Protected references refuse premature domain/household cascade.
Result/accounting retirement is **not implemented**; local content-free evidence must not be
silently destroyed to make erasure appear complete. Complete erasure, backup/provider absence
and ADR-019 independent operational restore admission are unproven/unactivated. **No final
deletion receipt is issuable.** This is an explicit incomplete privacy workflow.

## Plaid principal review and implementation limits

[ADR-022](../architecture/adr/ADR-022-plaid-credential-and-runtime-boundary.md): **APPROVE WITH
REQUIRED AMENDMENTS** for local deterministic implementation. It justifies a future dedicated
NOLOGIN/NOBYPASSRLS runtime because web/model/document/generic workers must have neither token
custody access nor decrypt capability. It covers exchange ambiguity, known-Item webhook
binding, current ES256/raw-body verification, atomic cursor/data refetch, unlink fencing,
rotation and backup limitations. No operational role, credentials or provider access were
created by this review.

The implemented seam is an ephemeral local keyring accepting only public synthetic token
strings: fresh AES-256-GCM data keys/nonces, separately wrapped key/version and authenticated
binding to environment, household, **incarnation**, local Item, provider Item and revision.
Fourteen unit tests cover successful bounded callback use, transplant/corruption, keyring
separation, rewrap/retirement, unknown metadata/versions, real-token-shaped refusal and
non-leaking errors. Static guards deny app/DB/model imports of the decrypt seam. JavaScript
cannot promise complete memory zeroization or sandbox a trusted callback.

**This is not durable Plaid custody.** Dedicated DB grants, Item/account/inbox/cursor journals,
owner-bound exchange/reconnect, durable sync/unlink, provider lookup/ingress, consent UI and
privacy/export integration still need implementation and restricted-role evidence. Existing
transport/signature tests passing as regressions do not establish those lifecycles. Local
work remains possible without provider credentials; this report does not call it blocked.

## Validation and security experiments

| Check | Final candidate result |
| --- | --- |
| Frozen offline install | PASS |
| Full build / typecheck | PASS |
| Lint | 0 errors, 13 existing warnings |
| Unit/regression suite | 1,947 passed |
| Restricted-role PostgreSQL/RLS + HTTP | 764 passed: 283 DB + 481 HTTP |
| Local controls | 203 passed |
| Architecture guards | 7 passed |
| Restored publication/processing suite | 53 passed, already included in DB total |
| Isolated ClamAV + composed publication/custody/deletion proof | 1 passed |
| Selected security mutations | 8 detected and restored |
| Original user files | 386/386 unchanged |

All final-candidate commands/log hashes, toolchain versions, SQL readback, sizing and original
preservation evidence are in [the evidence manifest](evidence/document-publication-native-20260921.json).
Pinned scanner remains at its existing 40-second/3-GiB boundary with bounded cleanup; no
budget or timeout was increased. Historical queued cause and contention risk remain open.

Eight deliberately weakened controls are detected and restored: (1) completion without a
reviewed artifact; (2) result-source hash substitution; (3) over-cap reviewed reuse; (4) charge
without processing intent; (5) custodied source substitution; (6) result without review intent;
(7) removed encryption AAD; (8) removed incarnation binding alone. SQL function definitions
and restored source bytes are compared, positive suites rerun, and final readback shows no
disabled user trigger. These are selected counterfactuals, not proof against every attack.

Preserved development failures: local sandbox PostgreSQL denial (restricted-role run passes
with authorized loopback access); incorrect grace/timestamp and UUIDv7 synthetic fixtures;
wrong proof event scope (corrected before admission, expected deliveries retained); an app-to-AI
import caught by a guard (moved to local proof composition, guard retained); lint/type-narrowing
failure; missing incarnation binding found during review. The pre-final attempt was stopped
for the latter correction. No earlier failed/partial run is represented as final-candidate
success. Experimental migration development used a different disposable cluster; final
checksum evidence comes only from the fresh final cluster.

## Database/migration and rollback posture

Fresh local endpoint `127.0.0.1:55546/pellum_results_final_20260921` uses PostgreSQL 18.3,
pgvector 0.8.1. 31 completed migrations, zero unfinished/rolled back, all source checksums match.
37 forced-RLS tables, 50 policies, 28 privacy fences and 16 journal audit triggers.
Zero ensure_rls triggers, provider table grants, runtime-owned tables, new SECURITY DEFINER
functions, new role memberships or disabled user triggers. Generic worker billing grants
remain zero.
No new role or decrypt grant. The historic reviewed dispatcher escape hatch is unchanged;
this is not a claim that every old role is NOBYPASSRLS. Temporary restricted-role passwords
are cleared/roles NOLOGIN, TEST activation false, fixture journals empty after the proof.

Migration 30 creates two empty journals plus a composite processing identity index. Existing
processing-table index construction/reference checks require bounded locks and a hosted
volume/compatibility review; migration 31 adds invoker triggers without a row rewrite. Both
use 5-second lock/60-second statement limits. Prior migration 28's nonempty-document/nonzero-
legacy-usage cutover refusal remains; no hosted cutover is authorized by local migration
success. Rollback disables new callers while retaining immutable evidence/charges and source
protection. It does not drop journals or turn ambiguous/completed work into fresh waiting work.

Synthetic composite widths are 528 bytes/result and 128 bytes/review, four indexes each.
100k households × 50 documents/month gives five million pairs, about **3.28 GB/month of
composite payload alone**. Heap/page/index/WAL/audit/backups and processing ledger are extra;
retention/cost/workload testing is required. No 100k-household load benchmark was performed.

## Remaining work and exact continuation order

1. Finish local cancellation/old-period review resolution and quota-preserving content/journal
   retirement without destroying ADR-019 restore protection; add concurrency/crash controls.
2. Implement ADR-022 dedicated restricted-role Item/operation/encrypted custody journals, then
   account/inbox/cursor atomic sync/reconnect/unlink and privacy inventory/export classification.
   No external credentials are needed for deterministic local durability; do not stop for them.
3. Build reviewed original/identifier export and complete deletion/category reconciliation;
   keep identifiers omitted until the narrower reveal boundary is proven. No final receipts.
4. Complete authenticated browser/accessibility state matrix, reminder/recovery/privacy and
   full TEST billing lifecycles. Obtain hosted retention/product decisions and independently
   approved infrastructure/restore/provider gates only when needed.
5. Only after separate release authorization: exact-SHA hosted migration/provider/staging
   acceptance and complete security/UI matrix. Local evidence cannot substitute for these.

Supabase: three September 13 upstream gateway 504s confirmed; deeper request-linked cause
unknown. OAuth replacement established; historical management-token invalidation unproven.
Sanitized support packet **PREPARED BUT UNSENT**. No timeout increase or credential retry.
Legal operator/jurisdiction/public contacts, provider-linked acceptance, operational alerts/
cost evidence and independent restore authority remain prerequisites. No real-content model
processing, Live Stripe, real Plaid, Production, DNS, merge/deployment or public launch gate
is opened. Independent local engineering remains, so this is not a completed launch program.

Loopback preview restored at `http://127.0.0.1:4317/`; landing-page HTTP 200 and Pellum branding verified. This is signed-out availability only, not authenticated/full-stack evidence.
