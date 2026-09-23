**Latest local cited-publication checkpoint (September 21):** [verification report](document-publication-verification-20260921.md)
records tested implementation `1ed927d4737469c305f2888490a8c61cc922ddc7`.
A canonical public synthetic PDF now composes upload admission, isolated real ClamAV,
separate clean custody, bounded parser/redactor/stub, immutable result provenance, explicit
owner review, one cited item/obligation, exactly-once UTC-month charge and 11 scoped local
outbox deliveries. SQL refuses fake result UUIDs, source substitution, missing intents,
foreign/lost owners, stale month/fences/custody and over-cap reuse. Same-month plan/revision
reuse retains the original artifact without provider retry. Quota API/UI provides DB
usage/queues/grace and Free 8/10/Premium 40/50 warnings; this is not browser E2E.
**1,947 units, 764 restricted integrations, 203 controls, seven guards, eight restored
security mutations and one composed real ClamAV lifecycle** pass. Frozen install/build/
typecheck/lint pass (0 errors, 13 existing warnings). Fresh local DB: 31 matching migrations,
37 forced-RLS tables, 50 policies, 28 privacy fences, 16 audit triggers; no new role,
SECURITY DEFINER, provider grant or runtime ownership. TEST activation false; all 386
original files unchanged. Nothing pushed, deployed, hosted, or changed at a provider/PR.

ADR-022 is **APPROVE WITH REQUIRED AMENDMENTS**, local review. Ephemeral synthetic-only
AES-GCM envelope tests bind household/incarnation/Item/revision; **durable Plaid Item/
inbox/cursor/sync/unlink is still unfinished**, not excused by external provider access.
Protected result/review journals are inventoried and cannot be prematurely cascaded;
local byte absence is observed but journal retirement and final receipts remain unfinished.
Original/identifier exports remain omitted, historical artifacts readable. Local pending
storage/35-day hold is not product policy. Hosted policy and operational restore/provider
evidence are separate gates. Authenticated accessibility QA and additional independent
local engineering remain. Supabase deeper 504 causality and historical token invalidation
remain unknown; packet PREPARED BUT UNSENT. **Production preflight NO-GO.** This supersedes
older local summaries below, not their timestamped hosted evidence.

**Latest local processing/custody checkpoint (September 21):** [verification report](processing-custody-verification-20260921.md)
records tested implementation `a88ace349e259ece92ba2cfc1720c2fc1d15962f`.
New ADR-021 separates unchanged seven-day quarantine from bounded local synthetic
clean custody. DB-clock reservations charge only successful completion with a durable
result reference/outbox; upload and scan do not consume processed allowance. Exact-once,
period/revision, deletion fences, bounded retry/ambiguity and storage-admission races
pass. Unreleased migration refuses existing documents **or nonzero legacy usage**.
Partial export includes safe pending states and preserves historical artifacts;
privacy inventory covers both new journals without granting object/lease visibility.
**1,929 units, 733 restricted-role integrations, 199 controls, seven guards, five
restored security mutations and one isolated real ClamAV lifecycle** pass at the exact
candidate. Build/typecheck/frozen install/lint pass (0 errors, 13 existing warnings).
Fresh local DB: 29 checksum-matching migrations, 35 forced-RLS tables, 48 policies,
26 privacy fences, 14 journal audit triggers; no new privileged role/SECURITY DEFINER,
provider table grant or runtime ownership. TEST activation false; worker logins closed.
All 386 inventoried original files unchanged; no push, provider, PR or hosted change.

**Remaining local work:** result-artifact/provenance composition, pending/usage UI,
quota-preserving erasure, full originals/identifier export, durable Plaid and exhaustive
authenticated accessibility/lifecycle QA. Hosted retention/product policy, clean-custody
infrastructure and account/provider evidence remain separate gates. The 20-object/500-MiB
prototype is not a published Premium storage allowance. ADR-019/final receipts remain
unactivated. Supabase deeper 504 causality and historical token invalidation remain
unresolved; support packet PREPARED BUT UNSENT. **Production preflight NO-GO.**
This supersedes the older local checkpoint, not historical hosted evidence.

**Latest local TEST billing/plan checkpoint (September 21):** [verification report](billing-authority-verification-20260921.md)
records tested implementation `722e0e9908c9e0f48831d624b4dac0fa12d26c1b`.
ADR-020 is **APPROVE WITH REQUIRED AMENDMENTS**: dedicated narrow TEST authority,
old worker billing grants removed, UUID internal reconciliation, DB-clock atomic
lease/revision/audit/outbox guards, and default-disabled effective TEST projection.
PRD §21.2 ratifies Free 10/Premium 50 processing policy and self + one/unlimited
managed-human semantics. Member gateways and race/expiry guards pass; explicit self
is bound by the server. **Processed-document quota and safe pending custody remain
unfinished** because the old upload counter and seven-day quarantine are insufficient.
Strict historical export readability lands; export remains partial, Plaid durability
and full browser/accessibility/provider evidence remain unfinished. **1,917 units,
707 restricted-role integrations, 199 controls, seven guards, one isolated real ClamAV
lifecycle, three restored SQL weakenings and two historical audit-attack regressions**
pass. Frozen install/build/typecheck/lint pass (0 errors, 13 pre-existing warnings).
Local DB: 27 checksum-matching migrations, 33 forced-RLS tables, 46 policies, 24 fences,
12 journal audit triggers; zero new SECURITY DEFINER/provider grants/runtime ownership.
Billing role NOLOGIN/NOBYPASSRLS, no memberships; TEST activation false after cleanup.
Migration requires empty old billing journals or a separate compatibility review.
All 386 original files unchanged. No push, PR/provider/hosted/deployment changes.
Supabase deeper 504 cause and historical token invalidation remain unresolved; support
packet PREPARED BUT UNSENT. ADR-019/final receipts remain closed. **Production preflight
NO-GO.** This supersedes older local summaries below, not their historical hosted
observations; independent local work remains possible.

# Pellum staging release checkpoint — September 13, 2026

**Latest local whole-app policy checkpoint (September 21):** [verification report](whole-app-policy-verification-20260921.md)
records tested candidate `2ded06635ee74b590a9bc193440dea9098d7de9a`: mandatory
session/MFA admission for all current ordinary HTTP methods and household SSR reads;
explicit synthetic-loopback MFA/recovery mounts; shared fail-closed export limiter;
content-free scanner stages; generated-server-action inventory. **1,901 units,
675 restricted-role integrations, 199 controls, seven guards, one isolated real
ClamAV lifecycle and three detected/restored source weakenings** pass. Frozen
install/build/typecheck/lint pass (zero errors, 13 pre-existing warnings). All 386
original files unchanged. Local DB remains 24 checksum-matching migrations, 32
forced-RLS tables, 42 policies, 23 fences, 11 audit triggers; roles/grants unchanged.
[ADR-020](../architecture/adr/ADR-020-dedicated-test-billing-authority.md) is PROPOSED,
not activated. Complete export/deletion, Premium projection, durable Plaid and full
UI/accessibility/provider verification remain unfinished; independent local work
remains possible. Extra factor/admission reads need hosted latency/load evidence.
Supabase deeper 504 cause and historical token invalidation remain unknown; support
packet PREPARED BUT UNSENT. No push/PR/provider/deployment changes; ADR-019 authority
and final receipts remain closed. **Production preflight NO-GO.** Older entries below
are historical; this is local evidence, not a fresh stable-staging readback.

**Latest local sensitive-lifecycle checkpoint (September 21):** [verification report](sensitive-lifecycle-verification-20260921.md)
records tested implementation `af570debe2298b2045c34abf39066ee972979a71`: transaction-time
account/owner/MFA/fence checks through audit flush, bounded provider evidence, guarded
local MFA/recovery/partial-export HTTP compositions, and cap/restore race and DB-clock
fixes. **1,874 units, 657 restricted-role integrations, 195 controls, seven guards,
one isolated real ClamAV lifecycle and 11 restored source weakenings/historical
regressions** pass. Frozen install/build/typecheck pass; lint has zero errors and
13 pre-existing warnings. All 386 inventoried user files remain unchanged.
Local schema remains 24 completed checksum-matching migrations, 32 forced-RLS tables,
42 policies, 23 fences and 11 journal audit triggers; roles/grants unchanged.
Controlled CPU contention reproduced a scanner deadline, but does not establish the
cause of the historical queued result or hosted Linux reliability. Whole-app MFA,
complete export/deletion, Premium activation and Plaid durability remain incomplete;
independent local implementation remains. Supabase deeper cause and historical token
invalidation remain unresolved; support packet PREPARED BUT UNSENT. ADR-019 authority
and final receipts remain disabled. No push, PR/provider changes or deployment.
**Production preflight NO-GO.** Local evidence is not stable-staging/full-stack evidence;
earlier entries below are historical checkpoints, not fresh provider readbacks.

**Latest local enforcement/reconciliation checkpoint (September 20):** [report](account-enforcement-verification-20260920.md)
records centralized signed sensitive-operation policy, bounded strength/breach recovery,
encrypted export publication/revocation journal, and serialized durable Stripe TEST
state with atomic audit/outbox. **1,822 units, 625 restricted-role integrations, 195
controls, seven guards, 27 restored negative-control mutations** pass. Real ClamAV
lifecycle passes in isolation; a concurrent queued run is retained as an unresolved
local reliability observation. Local DB: 24 checksum-matching migrations, 32 forced-RLS
tables, 42 policies, 23 fences, 11 journal audit triggers; unchanged roles, no provider
grants/new SECURITY DEFINER/runtime-owned tables. All 386 user files unchanged.
Whole-app MFA, complete export/deletion, Premium activation and Plaid durability remain
unfinished; no hosted/full-stack evidence. Supabase cause/token containment and ADR-019
operational authority remain open. Packet unsent; no push/PR/provider/deployment changes.
**Production preflight NO-GO.** Earlier entries are historical.

**Latest local account-lifecycle continuation (September 20):** [report](account-lifecycle-foundations-20260920.md)
records ADR-019 **APPROVE WITH REQUIRED AMENDMENTS**, unmounted bounded MFA/recovery,
durable scoped challenge consumption, partial consistent encrypted local exports,
revocation-crash cleanup, and a Stripe TEST binding/inbox journal. No independent
restore authority, final deletion receipt, complete export, full MFA enforcement,
Stripe entitlement lifecycle or Plaid durability is claimed. No route/provider activation.
Final local evidence: **1,716 units, 586 restricted-role integrations, 195 controls,
seven guards, one real ClamAV synthetic lifecycle, 16 detected/restored weakenings**;
frozen install/build/typecheck/lint pass (13 pre-existing warnings). Fresh local schema:
22 completed migrations, 30 forced-RLS tables, 40 policies, 21 fences, nine audit triggers;
zero provider grants/new SECURITY DEFINER/runtime-owned tables, unchanged role inventory.
All 386 original user files remain unchanged. Supabase deeper 504 causality and historic
token invalidation remain unresolved; packet **PREPARED BUT UNSENT**. No push, deployment,
provider mutation or PR #5 change. **Production preflight NO-GO.** Independent local work
remains; prior entries below are historical, not current provider readbacks.

**Latest local privacy/account continuation (September 20):** [report](privacy-account-foundations-20260920.md)
adds durable bounded inventory/reconciliation, partial owner-only export intents and
safe pages, signed recent-auth evidence, and an ADR-019 restore-authority prototype.
**ADR-019 remains PROPOSED; no automatic journal retirement, restore activation or
final deletion receipt.** Exports have no complete ZIP or generated artifact; recovery/MFA,
Stripe TEST durability and Plaid Sandbox durability remain required work.
Native evidence: **1,617 units, 533 restricted-role integrations, 192 controls, seven guards,
one real local ClamAV lifecycle, nine caught/restored security weakenings**; full frozen
install/build/typecheck/lint pass (13 existing warnings). Local schema: 20 completed
migrations, 27 forced-RLS tables, 37 policies, 18 fences, six audit triggers; no new role,
provider grant or SECURITY DEFINER. All 386 inventoried user files remain unchanged.
Supabase deeper 504 causality and historical token invalidation remain unproven; support
packet UNSENT. Nothing pushed, deployed or changed remotely. **Production preflight NO-GO.**
The older entries below are historical checkpoints, not current provider readbacks.


**Latest local scanner continuation (September 20):** [report](adr018-local-scanner-continuation-20260920.md)
records pinned real ClamAV execution, effective Linux-container controls, a complete
canonical public PDF subset, release-bound durable scan orchestration and fenced
local row/file erasure with independent observations and durable component leases.
Four cross-household FK gaps were caught and repaired with insert/update negative
controls and valid-cascade regressions. The synthetic proof uses
simulated review and local transport; provider/account/backup erasure, retained job
history retirement and authenticated restore-ledger authority remain incomplete.
No hosted activation or provider mutation. Supabase deeper 504 causality and old
management-token invalidation remain unresolved; support packet UNSENT. **NO-GO**.
Final local evidence: **1,556 units, 515 integrations, 192 controls, seven guards,
one real-scanner synthetic lifecycle and 12 detected deliberate weakenings**.
Nineteen local migrations, 27 forced-RLS tables and 37 policies read back cleanly.
Prior checkpoints below retain their historical scope and counts.


**Latest ADR-018 approval continuation (September 20, local only):** architecture
now approved; [implementation report](adr018-local-foundations-20260920.md) records
an OCI sandbox contract, six durable scan/deletion journals, narrow worker/verifier
roles, DB-time leases and write fences, and a synthetic parser/redactor with a
single-use provider capability. No hosted activation. Native evidence: 1,508 units,
492 PostgreSQL/RLS integrations, 188 local controls, seven architecture guards,
eight caught security mutations and full build/typecheck/lint (13 existing warnings).
Local schema: 14 completed migrations, 27 forced-RLS tables, 33 policies; zero
provider table grants, no new SECURITY DEFINER, and no runtime-owned tables.
Docker engine requests time out; Linux enforcement and actual scanner release pins
remain unproven. Real-format redaction, complete deletion/provider/backup receipts
and the complete synthetic lifecycle remain open. Supabase deeper 504 causality and
historical management-token invalidation remain unresolved; support packet unsent.
All 386 inventoried user files are unchanged. Nothing pushed/deployed, PR #5 untouched.
**Production preflight: NO-GO.** The older entries below are historical checkpoints.

**Later local-only continuation, September 20:** [document-security report](document-security-foundations-20260920.md)
records tested local SHA `3913413791c550ac90c004b7f0929b83430a8e8c`, 1,443 units,
467 disposable integrations, 156 controls and seven architecture guards. It is not
a staging deployment or hosted lifecycle result. A–D remain incomplete beyond the
proved local boundaries; ADR-018 is proposed. [Freshly correlated Supabase evidence](supabase-diagnostic-followup-20260920.md)
supersedes historical access/revocation-pending notes below: OAuth replacement is
verified, historical management-token invalidation and deeper 504 cause are not.
The packet remains unsent. No provider state was changed or reverified during the
document increment. The rest of this file preserves its dated hosted checkpoint.

**NO-GO for final Production preflight.** This is an incomplete staging candidate with retained failures, external security/cost gates and substantial implementation work outstanding. It is not a public-launch approval or a claim that the remaining work is all provider-blocked.

Tested implementation SHA: **a352d1c083d17b0d1282eb8ef4e59aa28ed5aada**, branch `codex/launch-foundations`. Documentation/evidence may have a later commit; that does not change the tested application tree. [PR #5](https://github.com/MichalKuderski/AutoBureau/pull/5) remains **open, draft, unmerged**. The confirmation fix is preserved in PR #4's historical squash merge `3695e6cbb219d46674bbc5ffd891de2793fd002c`. Shared history has not been rewritten.

| Release area | Classification | Verified state and remaining gate |
| --- | --- | --- |
| Source control and temporary staging rule | PASS for this increment | Dedicated launch branch used. Exact `refs/pull/5/merge` rule 59896856 was temporarily added for the migration, then removed. Fresh readback is **main-only**, rule 58428124. Read-only auth trigger label removed. No merge or Production job ran. |
| Stable Vercel OIDC and alias | PASS, bounded proof | Native signed claims for both hosting scopes verified previously. Exact issuer/audience/team/project/environment feed the trust policies. September 13 22:23 readback confirms stable domain still points to **dpl_G5PaLPvpjwExBKFUpKXh2jf4gnu4**, with unchanged protection. This historical stable deployment is not the launch branch. |
| ADR-016 storage | PASS for native synthetic scope | Saved staging plan applied; effective AWS policy/configuration verified; **36/36** native build probes passed. Exact fixture cleanup completed. September 13 22:14 readback confirms **zero objects**, all four public-access blocks, BucketOwnerEnforced, AES256, seven-day expiration and one-day multipart cleanup. Intake stays **false**. |
| ADR-016 negative-control limits | KNOWN LIMITATION | Wrong-environment STS calls really failed in both directions. Foreign project/team/Production denial is supported by live-policy evaluation/simulation; no genuine signed token from those unrelated principals was obtained. Native build tests are not deployed-function or full document-pipeline evidence. |
| ADR-017 infrastructure | PROVIDER/USER GATE; NOT APPLIED | Independent eight-addition CloudFormation bootstrap change set saved/reviewed but **not executed**. Separate Terraform proposal has **69 additions**; no real saved Terraform plan or queue apply yet. Live inventory has **zero queues** and no job runtime roles. Complete cost/alert routing, bootstrap/state and bounded deployment authority before planning/applying. Storage's plan is not reused. |
| ADR-017 delivery implementation | PASS locally; live lifecycle incomplete | Transactional outbox remains authoritative. Independent per-consumer delivery rows, transactional inbox, scope/tenant checks, bounded claim/retry/reconciliation, strict opaque envelopes and SQS adapter implemented. Database-only synthetic worker has derived 60-second lease, one extension/120-second cap and concurrency one. No continuous workers. Real SQS security, failure-injection, DLQ and cleanup probes still required. |
| Cost and alerts | PROVIDER/USER GATE | Current Ohio rates and visible shared usage verified. Estimate **$42.14/month AWS**, **$67.14 with $25 other-provider reserve**, below $100 ceiling without relying on credits. Credit balance $94.68 at 21:33 UTC; two shared SQS requests used. Cost Explorer denied; actual invoice unverified. Monthly $100 budget is HEALTHY with actual 50/80/100% and forecast 100% thresholds. Encrypted SNS stack is UPDATE_COMPLETE and its exact recipient is verified; subscription confirmation and delivery remain pending. No paid upgrade. |
| Upstash | PASS for preservation; not application transport | Existing free Ohio database retained empty after exact compatibility fixtures were removed. No deletion, upgrade, real tenant use or application credential distribution. TLS/compatibility evidence does not satisfy paid at-rest/ACL features. |
| Scanner/dispatcher/retention | FAIL, required work | Durable dispatcher foundation exists; scanner service, effective isolation, deployed dispatcher, retention/reconciliation and deletion receipts remain incomplete. No scanner/model activation. |
| Pre-provider redaction | HARD BLOCKER | No proven architecture yet guarantees that prohibited identifiers cannot cross the model boundary. Real sensitive documents cannot reach Bedrock, Anthropic or any model. Token log scrubbing is not document redaction proof. |
| Document review/delivery | FAIL, required work | Scoped document views, upload-ticket/completion foundations and quarantine sealing exist. Intake remains disabled. Extraction, safe provenance, review saves, artifact delivery and synthetic end-to-end lifecycle remain incomplete. |
| Reminders | FAIL, required work | Manual deadlines, persisted preferences and notice feed/read state work in local tests. Materialization, provider delivery, retry/reconciliation, recurrence/snooze and end-to-end lifecycle remain incomplete. No provider send claimed. |
| Recovery/MFA/privacy | FAIL, required work | Session/confirmation boundaries are tested. Full recovery, MFA, export, deletion/undo/retention and independent provider erasure are not implemented/proven. Disabled controls remain honestly described, but do not satisfy launch acceptance. |
| Stripe TEST | FAIL, required work | Sandbox account access previously verified. Customer reuse, price mapping, checkout/portal, verified/idempotent webhook processing, entitlement lifecycle and UI/provider tests remain incomplete. No live charging. |
| Plaid Sandbox | REQUIRED LAUNCH WORK; partial implementation | Fresh Pellum Sandbox dashboard inventory completed. Closed Sandbox client, opaque Link binding/update mode, server exchange/removal and strict ES256/body-hash webhook verifier pass **41 focused tests**. Credential redaction adds nine regressions. Encrypted custody, Item/institution/accounts, reads/sync, durable webhook effects, routes/consent/UI, duplicate prevention, reconnect/unlink/privacy and actual Sandbox lifecycle remain required. No real accounts or Production access. |
| UI/UX | PARTIAL, exhaustive QA incomplete | Prior local browser evidence covers selected ledger, household/profile/member, onboarding, deadline, activity, notification and responsive journeys. Current tree has **22 page routes** plus auth handlers. Full route/control/state matrix, provider failure flows and stable-staging browser acceptance are not complete. No claim that every control works. |
| Accessibility | PARTIAL | Keyboard, dialog focus return, 320/390px layouts and specific error/empty states have local evidence. Complete screen-reader/axe/contrast/200% zoom and final stable audit remain required. No WCAG certification claimed. |
| Auth reliability | FAIL, staging blocker | Latest Preview **56/57**: wrong-password sign-in returned application 503 from **upstream HTTP 504 in 5,030 ms**. Provider request ID retained. This is before the ten-second application deadline; no automatic credential retry. Deeper Supabase cause unresolved. Earlier stable smoke failed 16/17; later stable 17/17 does not close it. |
| Database security | PASS for migration/current snapshot | **13 completed / 0 rolled-back migrations**, **21 forced-RLS tables / 27 policies**, no ensure trigger, **zero provider API table grants**. Migration preserved existing row/security fingerprints and removed 207 residual grants. New worker role is NOLOGIN/NOBYPASSRLS; no credentials distributed. Tenant tests run under restricted roles, not just admin. |
| Management credential containment | SECURITY BLOCKER, partial containment | A Supabase OAuth callback exposed management credentials in private tool output around 20:03 UTC. Values are not in repository evidence and were not used for subsequent API work. Management browser signed out; CUA session reset. GitHub OAuth revocation confirmation remains pending. Sign-out alone is not proof that the provider token was revoked. No blanket "secrets never exposed" PASS. |
| Production and financial environment separation | PASS for authorized operation scope | All live writes targeted staging. Production application was not accessed or modified. Stripe Live, Plaid Production, real financial ingestion, model processing, public launch and domain/DNS changes remain off. |

## Automated and hosted evidence

[CI 34786603924](https://github.com/MichalKuderski/AutoBureau/actions/runs/34786603924) passes on the tested SHA:

- **1,120 unit tests**: web 997, contracts 99, DB 16, operations 8.
- **443 real-database integration tests**: DB 70, web 373. CI uses PostgreSQL 16; disposable local verification also used PostgreSQL 18.
- Build, lint, typecheck, governance and architecture guardrails pass.
- Separate controls: OIDC 25; auth-smoke/diagnostic/tenant-fixture 22; deployment identity 6; ADR-016 bootstrap/saved-plan 21; ADR-017 bootstrap/plan 41. Mock Terraform storage 3 and jobs 2 pass. These are not live provider probes.

[Preview 34786603902](https://github.com/MichalKuderski/AutoBureau/actions/runs/34786603902) passes **17/17 smoke** and fails **56/57 acceptance** at wrong-password sign-in. Other endpoint semantics include correct cross-tenant refusal and signup sequence **204 → 202 → 202 → 429 → 429**. The previous implementation head `66b4a6a` passed Preview 57/57; that historical green run does not override this failure.

Stable staging was probed without promotion: **16/17 at approximately 22:06 UTC**, then **17/17 with the strengthened harness at 22:23 UTC**. No final-candidate stable acceptance, Stripe/Plaid/document/reminder/privacy lifecycle or exhaustive stable browser QA is claimed. [Read-only run 34786636939](https://github.com/MichalKuderski/AutoBureau/actions/runs/34786636939) verifies unchanged stable assignment/protection; its empty auth log projection leaves the earlier failure unresolved.

The **22:28:10 UTC** staging snapshot has **167 households / 167 entitlements**, zero documents and empty job delivery/inbox tables. The increase from the migration baseline 161 is six successful synthetic bootstraps across the last two Preview runs. The controlled confirmation account remains one confirmed auth user with one session. These are timestamped counts; later acceptance runs can add fixtures and must be reconciled independently. [Schema receipt](evidence/staging-schema-readback-20260913-2228.json).

The migration-only workflow [34785388749](https://github.com/MichalKuderski/AutoBureau/actions/runs/34785388749) committed the additive staging job schema and API-grant hardening. An earlier run failed before mutation because Prisma was not generated on the clean runner; the workflow now generates it explicitly. No migration assertion was relaxed. [Before/after receipt](evidence/adr017-staging-migration-20260913.json).

## External actions and continuation order

The alert recipient was supplied and configured. Two external confirmations remain:

1. **Credential containment:** GitHub → Settings → Applications → Authorized OAuth Apps → Supabase → revoke the affected authorization, then sign back into Supabase using a fresh authorization. Do not share credentials or tokens. Confirm completion so management access can be resumed safely and the exact provider request window investigated.
2. **Alert subscription:** confirm the AWS SNS subscription for `pellum-stg-operational-alerts` in the approved mailbox. Live readback at 23:27 UTC shows PendingConfirmation. Then verify the synthetic CloudWatch → encrypted SNS → email path before closing alert delivery.

After containment, inspect Supabase's exact request `01a09cdf-cf92-7e3b-a9cc-e59dfdd0a8fa` around **22:25:08–22:25:14 UTC September 13**. Resolve gateway/Auth/DB/dependency latency with provider evidence or retain the blocker. This packet has not been sent to provider support; no outside message is authorized by its preparation.

Then complete alert/cost evidence; reverify AWS identity, inventory and source; execute only the reviewed staging bootstrap if its gates still pass; establish bounded state/deployment authority; save/review the independent additions-only Terraform plan; apply only if every ADR-017 condition passes; run all required live synthetic queue/security/crash/DLQ/cleanup probes. Keep intake and continuous workers disabled. Proceed with the incomplete application work listed above and rerun affected tests.

## Production prerequisites and risk register

Before a GO recommendation: close auth reliability and the credential incident; finish both approved storage/job live gates; prove scanner/worker isolation, retention and safe pre-provider redaction; complete document/reminder/recovery/MFA/privacy and Stripe TEST/Plaid Sandbox lifecycles; complete accessible UI/control QA; deploy the **exact final candidate SHA** to stable staging; pass smoke, full acceptance and every specified lifecycle on that deployment; independently reverify tenant/RLS/roles/ownership, queue/storage policies, cost/alerts and environment separation.

Public launch additionally requires Plaid Production approval/readiness and separate authorization, Stripe live readiness and separate authorization, truthful legal operator/jurisdiction/support/privacy contacts and policy review, domain/brand clearance and separately authorized DNS, provider agreements, backup/recovery and privacy operating evidence. Existing unencrypted migration-host storage is a retained security risk; it was not changed under these approvals. Budget estimates are not invoice proof or hard caps. Unknowns remain; zero risk is not claimed.

The detailed [risk register](launch-risk-register.md), [auth investigation](supabase-auth-timeout-investigation-20260913.md), [cost plan](staging-infrastructure-cost-plan.md) and [Plaid checkpoint](plaid-sandbox-checkpoint-20260913.md) remain binding continuation evidence. Production stays untouched until separate explicit authorization.

## Alert continuation — September 13, 23:27 UTC

The two reported failure emails are accounted for: [ADR-017 run 34784963585](https://github.com/MichalKuderski/AutoBureau/actions/runs/34784963585) failed before DDL because the clean runner lacked generated Prisma; [successful migration 34785388749](https://github.com/MichalKuderski/AutoBureau/actions/runs/34785388749) includes the fix. [Deploy 34786603902](https://github.com/MichalKuderski/AutoBureau/actions/runs/34786603902) failed Preview acceptance at wrong-password sign-in, with actual upstream 504 after 5,030 ms. Later [CI 34787144530](https://github.com/MichalKuderski/AutoBureau/actions/runs/34787144530) and [Preview 34787144506](https://github.com/MichalKuderski/AutoBureau/actions/runs/34787144506) passed on `993ee5eac57e67bfa4aa18213bd4d7c2a5ada7f7`; the intermittent provider defect remains open. Stable staging was not promoted.

The first alert-stack creation hit an SNS service rejection of `sns:*` in the topic policy despite generic policy/template validation. Rollback retained only the newly created key and topic. Recovery used explicit supported SNS actions, verified the corrected live policy, imported those same physical resources and executed a separately reviewed four-addition completion change set. No duplicate key/topic was created. The resulting six-resource stack is UPDATE_COMPLETE. Exact live KMS policy/rotation, SNS encryption/policy, recipient and test alarm action match the reviewed source. [Sanitized readback](evidence/staging-operational-alerts-20260913.json). [SNS supported actions](https://docs.aws.amazon.com/sns/latest/dg/sns-access-policy-language-api-permissions-reference.html).

The budget is monitoring-only, with no automatic resource actions or paid reports. [Budget readback](evidence/pellum-staging-budget-readback-20260913.json). Notifications require separate delivery evidence; no spend or email receipt is inferred from successful resource creation. Queues remain absent and ADR-017 bootstrap remains REVIEW_IN_PROGRESS, unexecuted. Continuous workers, intake and model processing remain disabled. Production was not accessed or modified.

Affected local validation: 40 alert/saved-plan semantic checks and 2 mocked Terraform tests pass; cfn-lint passes. The first mocked test invocation was blocked by the local provider socket sandbox, then passed with the required local execution permission. These are not live queue lifecycle tests. Remaining actions: subscription confirmation, synthetic alert delivery, OAuth revocation confirmation, then the existing gated continuation plan. Release recommendation remains NO-GO.
