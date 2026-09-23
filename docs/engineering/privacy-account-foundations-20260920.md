# Local privacy and account-security continuation — September 20, 2026

Status: LOCAL SYNTHETIC DEVELOPMENT ONLY. Production preflight remains NO-GO.
This report is not hosted, full-stack, account-recovery, complete-export or launch evidence.

## Baseline and boundaries

Started from clean `cab6c494af6a26e11d864f9ede2e3c8035bb97a6` on
`codex/review-pellum-hardening-v2` in `/private/tmp/pellum-native-review-20260920`.
Git verifies that the delta from tested implementation
`2aec08a2ceb77f2fd7eea21713aba90146bb3c81` contained only governing/evidence documents.
Original checkout and inventoried user files remain outside the work scope.

No push, PR #5 mutation, merge, workflow dispatch, deployment, hosted migration,
provider configuration change, Production access, real payment/financial/document
activity, external model call, DNS change or public launch is authorized or performed.
All database mutations and scanner fixtures are task-owned disposable local work.

Supabase diagnosis is unchanged: three September 13 gateway HTTP 504s established;
no exact matching Auth-service or request-linked database/dependency trace proves
the deeper timeout-producing hop. Historical management-token invalidation remains
unproven. [Support packet](supabase-support-packet-20260920.md) is PREPARED BUT UNSENT.
No credential retry or timeout policy changed. No provider credentials were accessed.

## Bounded inventory and reconciliation

Migration `20260922000000_privacy_inventory_sources` adds nullable source/key
columns to the existing immutable manifest, with pair/closed-source constraints and
an independent unique key. Existing aggregate manifests stay readable. Fourteen
closed source projections use tenant RLS plus explicit household filtering. Each
transaction adds at most 100 entries; the durable last key resumes a committed page
after a lost response. Concurrent invocation serializes on the deletion request.

The independent restricted verifier checks missing/extra entries, count/component
and deterministic source-to-resource binding. A cursor is not completeness proof.
An added row below the cursor is detected, not silently accepted. Source drift needs
reconciliation before further erasure; there is no automatic deletion of inconvenient
evidence. Progress now pages beyond 250 resources with household/request-bound cursors.
Attempt diagnostics distinguish in-flight, expired, acknowledged-but-unverified,
exhausted and retryable work. Acknowledgement never means independently observed absence.

The tests include 1,005 inventory records, 505 progress resources and concurrent/lost
responses. SQL CHECK three-valued NULL behavior was caught and repaired: a non-null
source key with a null source is rejected independently by the DB.

At 100k households x 100 local resources, plan for 10m manifest rows and associated
audit inserts. The new short columns and unique B-tree add an estimated 1–2 GB to the
existing journal footprint, excluding base rows/audit/WAL/replicas. This is a sizing
estimate, not a capacity benchmark. Counts/text-key sorting can still scan a large
household; the five-second transaction budget refuses excess work. Production-scale
index/EXPLAIN/lock measurements remain necessary. The migration describes index-build
write locks, five-second lock refusal, no table backfill, and rollback that preserves
fences/evidence. No hosted migration is approved by this evidence.

## Independent restore authority and evidence retirement

[ADR-019](../architecture/adr/ADR-019-independent-privacy-authority.md) is PROPOSED.
It was written before the local prototype because this introduces a materially new
trust authority. No key custodian, hosted service, durable external checkpoint store,
restore activation or journal purge is selected or activated.

The prototype authenticates ephemeral Ed25519 signed statements for exact bounded
account/household subjects. It verifies authority, generation, fresh single-use
challenge, scope, strict shape, expiry and a monotonic sequence/root checkpoint port.
Checkpoint invocation is one attempt, capped at five seconds even if the port ignores
abort; expired-during-commit and mutated-input cases refuse. A late ambiguous commit
does not authorize serving and is never automatically retried.
The local checkpoint fixture rejects rollback/equivocation and deleted-to-active
resurrection even with a valid signature and newer sequence. Signatures authenticate
a statement; they do not prove full restore inventory or provider/backup expiry.
Malformed challenge content is never echoed in errors.
`activationAllowed=false` and final receipts remain disabled.

Retirement is a planner, NOT a delete executor. Proposed horizons are fourteen days
post-settlement for fenced-household delivery history and seven days for settled
scan diagnostics. The former references ADR-017's longest queue retention; manual
redrive/republication means queue age alone never proves replay impossible. The
seven-day scan hold is a new policy proposal, not a provider fact. Unknown incident
holds, live leases, remaining documents or missing authority refuse eligibility.
No audit/fence purge or new DELETE grants are implemented. Approval plus independently
retained tombstones, hold authority, leaf-first bounded deletion and readback are still
needed before actual retirement. Active-household deduplication history is excluded.

## Privacy export and deletion lifecycle

Local owner-only export intents now use the existing transactional outbox and audit.
Canonical UUID keys and a transaction lock deduplicate concurrent requests. Every
status/page read rechecks current owner membership and the irreversible deletion
fence. Intent access expires after 72 hours using database time. Bounded scalar pages
cover item/obligation IDs, enum state, integer-money representation and provenance links.
No attrs, free text, ciphertext, provider references, signed URLs or internal worker
capabilities are selected. Missing household/request, changed cursor scope, stale
owner membership, expired intent and deleted household all refuse.

This is deliberately a PARTIAL local domain foundation. It is not a snapshot,
originals/JSONL/audit ZIP or account-wide export. `complete=false` and
`artifactAvailable=false` are explicit. No generated artifact or signed URL exists,
so 72-hour artifact deletion/revocation has NOT been proven. The HTTP route, complete
builder, encrypted artifact storage/expiry, delivery and UI remain unfinished.
The existing 14-day undo, irreversible fence, leased erasure and progress contracts
remain intact; final deletion receipts stay disabled. Provider/backup state remains
unverified. New exports do not cause a false “deleted everywhere” claim.

## Recent authentication and MFA/recovery boundary

Current official [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields) and
[MFA](https://supabase.com/docs/guides/auth/auth-mfa) documentation were consulted.
Signed top-level `amr`, `aal` and `session_id` claims are projected only after existing
signature/issuer/audience verification. User/app metadata cannot supply them. The
local sensitive-operation seam requires a recent password or, when enrolled, aal2
and recent TOTP, plus fresh server-sourced factor evidence bound to the same user/session.
Token `iat`, refresh, recovery, magic link and signup alone cannot provide step-up.
The fifteen-minute ceiling follows the PRD sensitive re-auth policy.

This is not a live factor/session lookup. Unknown factor state fails closed; session
revocation is explicitly NOT verified by this seam. No HTTP route accepts these facts
from a browser. Doc 06's household-dependent MFA-enforcement policy must additionally
be applied when integrating a route; this helper does not inspect secret presence.
Enrollment/challenge/verify, recovery completion, lost-factor recovery, CSRF/rate limits,
audit, rotation/revocation and exact cookie behavior still need their complete flow.
The existing HttpOnly architecture, origin protections and single-attempt credential
operations remain unchanged. No browser-held auth SDK or provider mutation was added.

## Remaining work and decision boundaries

1. Review ADR-019's independent trust plane and retention/incident-hold policy. A
   durable checkpoint outside the restore snapshot, authenticated writer/key custody,
   rotation/revocation, complete inventory and backup-retention proof cannot be inferred
   from an in-memory test fixture. Actual retirement/final receipts remain blocked.
2. Independently continue local server-side recovery/MFA and live-factor lookup adapters,
   then wire owner privacy request/undo/progress behind recent auth, CSRF and rate limits.
3. Complete consistent account export, original/identifier reveal rules, ZIP generation,
   encrypted artifact authority, TTL/revocation/cleanup, notification and audit coverage.
4. Finish Stripe TEST durable inbox/customer binding/provider refetch/entitlement state
   machine and seven-day payment grace. Existing official SDK signature/catalog tests
   remain useful; this continuation does not complete or activate billing.
5. Finish Plaid Sandbox durable inbox, encrypted custody, cursor/reconnect/unlink/privacy.
   No new Plaid implementation/provider evidence is claimed here.
6. Backend-supported UI/accessibility, then separately authorized exact-SHA staging
   lifecycle/acceptance and provider/restore evidence. Existing canonical PDF/ClamAV
   boundaries stay narrow; no arbitrary PDFs or real model/document processing.

These independent local items remain open; the ADR decision is not a claim that all
remaining engineering is externally blocked. Pricing remains provisional $12/month or
$99/year. US/English and the single account-holder household model remain unchanged.

## Validation receipt

Final counts, SHA, versions, hashes, warnings and migration/role readback are recorded
in the companion machine-readable evidence receipt after the complete run.

## Final native evidence

Tested implementation: `40d0c78e0b728acf56fb670da1dd935bf6a31f25`. The subsequent
commit contains documentation/evidence only; resolve its SHA from Git.

| Check | Result |
|---|---|
| Frozen offline install, build, typecheck | PASS |
| Lint | PASS; zero errors, 13 pre-existing warnings |
| Full units | **1,617** (web 1,328; AI 89; contracts 152; DB 40; ops 8) |
| Disposable PostgreSQL/RLS integrations | **533** (DB 156; web 377) |
| Local controls / architecture guards | **192 / 7** |
| Real local ClamAV synthetic lifecycle | **1** |
| Deliberate weakenings caught/restored | **9** |
| Local migrations | **20 completed; 0 rolled back; 0 unfinished; all checksums match Git** |
| RLS / policies / fences / journal audit triggers | **27 forced / 37 / 18 / 6** |
| Provider table grants / runtime-owned tables / new SECURITY DEFINER | **0 / 0 / 0** |
| Original inventoried user files | **386/386 unchanged** |

Node 22.16.0, pnpm 10.34.5, Next 15.5.22, TypeScript 5.9.3, Vitest 3.2.7,
Prisma 6.19.3, Stripe SDK 22.6.2, PostgreSQL 18.3 and pgvector 0.8.1.
Existing webpack large-string and Next ESLint-plugin warnings remain. Deliberate
failure logs are separate from the passing candidate suite. The independent checkpoint
fixture remains in-memory, not a durable external authority.

Non-privileged app/worker/verifier connections exercise authorization. Their roles
are not table owners/superusers; the existing reviewed dispatcher BYPASSRLS escape
remains unchanged and NOLOGIN. Other runtime roles are NOBYPASSRLS. Temporary document/retention/verifier
role passwords are cleared and NOLOGIN restored. Zero journal/delivery/inbox fixture rows
remain. The original development cluster was preserved; the task-owned final cluster
is stopped after readback. No hosted schema/role posture is inferred from these facts.

Nine mutations cover malformed-input error echo, checkpoint abort, signature, challenge
replay, checkpoint rejection, recent-auth freshness, export ownership, deletion fence
and intent expiry. Each produced an assertion failure before exact source restoration.
They are new evidence for this candidate; the prior twelve scanner/erasure mutations
remain historical evidence, not a new combined count.

[Machine-readable receipt](evidence/privacy-account-native-20260920.json) contains
exact component counts, versions, migration checksums, role/constraint readback,
absolute log paths and SHA-256 hashes.

## Focused local commits

- `43ce5e3` — feat: reconcile bounded privacy inventories and deletion progress
- `88a484c` — feat: prototype independently signed restore reconciliation
- `810cd34` — feat: require signed recent authentication evidence for privacy seams
- `4f02ff3` — feat: persist owner-scoped partial export intents through outbox
- `e6093f4` — fix: reject restore resurrection and normalize privacy request keys
- `3b13b6d` — fix: bound independent checkpoint calls and reject late decisions
- `8b304fe` — fix: keep malformed restore challenges out of diagnostic errors
- `40d0c78` — fix: bound restore subject collections before schema traversal
