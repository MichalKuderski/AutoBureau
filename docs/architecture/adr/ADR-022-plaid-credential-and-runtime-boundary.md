# ADR-022: Read-only Plaid credential custody and durable effects

**Decision: APPROVE WITH REQUIRED AMENDMENTS, local principal-security review,
September 21, 2026.** This approves the following LOCAL deterministic architecture
under the founder's continuation mandate, not provider/deployment/key provisioning.
All requirements below are mandatory before enabling any runtime. No Production,
real financial data, payment initiation or financial advice. Existing Sandbox
transport alone is not durable implementation or launch readiness.

## Authority and threats

A dedicated `app_plaid_sandbox` runtime is justified by decrypt authority: the web
app, generic worker, dispatcher, document/model runtime and billing reconciler must
not possess an access token or the key capable of recovering it. This is privilege
reduction, not symmetry with billing. The dedicated runtime is trusted with the
connected Item's read/remove capabilities; compromise can read its provider data.
SQL cannot make a stolen provider token tenant-scoped at Plaid. Revoke/remove and
rotate upon compromise; never claim that ciphertext encryption restricts a leaked
plaintext token. Keep provider credentials and KMS grants separate from web deployment.

The DB role must be NOLOGIN/NOBYPASSRLS, no memberships/ownership/SECURITY DEFINER,
exact column grants and forced household RLS. No Stripe, document, identifier,
MFA/recovery, generic inbox or deployment authority. Owner continuity reads only
bound owner UUID/role, current household and deletion fence. The app may request
closed opaque operations and read a separate safe state projection, never encrypted
custody or provider tokens. No existing role receives decrypt authority.

Threat controls: malicious browser/app cannot supply tenant/provider binding; hostile
webhook cannot choose a household; copied ciphertext cannot decrypt under a different
household/Item; compromised document/model/job runtime has no ciphertext or key grant;
old backups cannot resume token use until ADR-019 independently admits the restored
incarnation. That operational authority remains unactivated, so hosted restore/serving
stays gated. A compromised dedicated financial runtime is an explicit residual risk.

## Encryption, rotation and admission

Use standard envelope encryption: fresh 256-bit data key, AES-256-GCM with fresh
96-bit nonce, 128-bit tag, separately wrapped data key and explicit wrapping-key
version. Authenticated associated data is a fixed versioned encoding of environment,
opaque household incarnation, immutable local Item UUID AND exact provider Item ID.
Rewrapping/rotation is compare-and-swap on credential revision, preserves bindings,
never makes a removed Item active and rechecks unlink/deletion fences. Key registry
and external KEK custody require separate operational review; deterministic local
fixtures use ephemeral keys only. Never persist plaintext, public token, logs/errors,
export fields or outbox/audit payloads containing tokens. Application `item_secrets`
remains exclusively the identifier facility; Plaid tokens are separate provider
credential custody, inaccessible to ordinary application/model roles.

Link/exchange requires current owner, explicit read-only consent/version and an
opaque single-use local operation UUID bound before I/O. Store no public token.
Claim and commit outside provider I/O with DB-time bounded lease; recheck current
owner/incarnation/deletion fence after the call. Returned Item/account bindings must
match that operation and environment. Unique provider Item per environment prevents
cross-household reattachment; refuse duplicates without enumerating their owner.
Timeout/crash after exchange starts becomes indeterminate, not automatic exchange
retry. Reconnect updates an existing binding; it cannot swap an Item identity.

## Verified ingress and sync

The [current Plaid mechanism](https://plaid.com/docs/api/webhooks/webhook-verification/)
uses ES256, provider verification key by kid, JWT age no more than five minutes and
constant-time SHA-256 comparison of the exact raw body. Enforce these (including
future timestamps, bounded body/key fan-out and key expiry); use the existing reviewed
JOSE verifier. Key lookup has fixed provider routing, no caller URL. Never trust
webhook metadata as tenant authority. Resolve verified Item to immutable binding in
a separately reviewed minimal lookup, then enter household scope. Unknown Items get
the same non-enumerating acknowledgement/refusal. Ordinary unscoped Prisma is forbidden.
The webhook inbox stores body digest and closed signal, not raw bodies. Exact duplicates
are idempotent; reordered signals schedule a current provider refetch, never overwrite
state with stale event payload. Per-Item revision/fence prevents sync after unlink.

Persist cursor and account/transaction changes atomically after bounded pagination
outside a transaction. Recheck scope, cursor/revision, owner, lease and deletion state.
Cursor is never authorization. Apply added/modified/removed transaction IDs idempotently;
reordered concurrent fetches lose CAS rather than overwrite. Plaid's documented
[mutation-during-pagination restart](https://plaid.com/docs/api/products/transactions/)
restarts from the original cursor with a bounded READ retry budget, distinct from
forbidden ambiguous credential retries. Exhaustion leaves cursor/data unchanged.
Provider errors project closed login-required/revoked/unavailable states, no raw errors.
Liabilities/balances require equivalent bounded read/consent scopes; no new products
or payment APIs silently enabled by an account link.

## Unlink, privacy and outcome limits

Unlink first fences claims/sync under the household privacy and Item locks. A stale
in-flight sync cannot commit. Remove-item call occurs outside the transaction;
acknowledgement, timeout and independently established provider-invalid state remain
distinct. See [Item removal](https://plaid.com/docs/api/items/). Unknown provider outcome
requires reconciliation, not blind success or token erasure that loses the ability to
reconcile. Once evidence supports removal, destroy local encrypted custody and reconcile
derived data under approved retention; preserve content-free unresolved removal intent
and backup suppression. Local token deletion alone NEVER proves provider deletion.
No final deletion receipt. Audit/export omit credentials, keys, cursor/lease capabilities;
safe connection/consent/error states and user-owned financial records need explicit
versioned export categories and omission notices. Item/custody/account/transaction/inbox/
operation rows must all be inventoried and fenced before implementation is considered done.

## Implementation gate and review verdict

APPROVE WITH REQUIRED AMENDMENTS means these constraints govern the upcoming local
implementation. Tests must defeat cross-tenant ciphertext transplant, stale owner,
public-token/exchange replay, wrong environment, forged/stale webhook, reorder/duplicate
signals, cursor crash/rollback, unlink-vs-sync, deletion-vs-exchange, stale restored
custody and key rotation races. Restricted roles, not fixture administrators, establish
authority. Local cryptographic fixtures do not prove operational KMS/worker isolation.
No runtime/schema is activated by writing this ADR. Provider-linked acceptance, consent
UI, privacy reconciliation and operational isolation remain launch blockers.

### Local cryptographic seam

The first local implementation is deliberately dependency-free and disconnected:
ephemeral test-only envelope keyring, exact synthetic token grammar, AES-GCM with
versioned full binding, explicit key retirement and compare-before-rotation protocol.
It is not a KMS adapter or a runtime with DB authority. It never imports web/app/model
code, reads environment credentials or accepts a provider transport. Exported artifacts
contain ciphertext only. Tests may use deterministic public Sandbox-shaped strings;
this does not authorize a real token entering the seam. Durable Item/inbox/sync
implementation still requires the dedicated grants/fence/ownership migration and
restricted-role evidence above; an in-memory map is not called durable custody.

### Durable local exchange increment

Implement separate forced-RLS subject, exchange-operation, Item and credential tables.
The subject incarnation is DB-generated and immutable; it is a local binding, NOT the
independent ADR-019 enrollment registry. No restored database may serve on its authority.
Only the owner can create a consented exchange intent. A dedicated app_plaid_sandbox
role can claim once with a 60-second DB-time lease; expiry becomes indeterminate and
never causes another exchange. The local deterministic adapter runs outside transactions.
Completion binds the original operation/owner/incarnation, immutable provider Item and
sealed credential in one transaction, with current owner/fence checks and closed opaque
outbox/audit effects. Lost completion acknowledgements reuse the same Item; no new token
exchange. Conflicting Item attachment returns a coarse refusal.

The role is NOLOGIN/NOBYPASSRLS with no memberships/ownership/security-definer functions.
Grant only its four journals, bound-owner status reads, deletion fence checks and narrow
audit/outbox columns. Web app reads a safe column projection and cannot read ciphertext,
wrapped key or internal provider reference. No grant on identifier, document, payment,
MFA or generic inbox state. Local fixture-only ciphertext is not a provider credential.
Institution/account/cursor/webhook/sync/reconnect/unlink require subsequent durable
state-machine increments; exchange-only evidence must not be presented as those flows.
All four new journals immediately enter privacy inventory, retention and export omission
classification. Derived-data-after-unlink policy is undecided; do not silently persist
real account/transaction data or infer unlink implies provider erasure.

Migration creates empty tables with bounded 5s lock/60s statement limits; no rewrite of
existing tenant data. At 100k households assume one subject and up to five Items/intents/
credential rows each only for sizing, not product limits. Ciphertext is bounded to 512
bytes plus 48-byte wrapped DEK/tags/nonces; measure row/index overhead locally. Rollback
disables callers and retains journals/fences; do not drop encrypted custody while an
external removal remains unresolved. No hosted invocation or persistent KEK is authorized.

### Local bound-owner status read amendment

The identity mirror `users` intentionally predates household RLS. A policy alone
on that RLS-disabled table cannot constrain a new financial runtime. Therefore this
local migration explicitly enables/forces RLS on `users`, preserves the existing
application identity-mirror authority with an all-rows `app_user` policy, and adds
only a SELECT policy for the financial role's exact bound owner through its forced
household-scoped subject. This does NOT key normal identity signup/session access
on the household GUC and does NOT enable an `ensure_rls` trigger. The dispatcher
already bypasses RLS; other existing roles receive no new identity grants. No profile
policy is changed. Verify unscoped and foreign financial identity reads return no
rows and existing signup/session integrations still pass. This is a targeted new-role
boundary, not a claim that the application identity mirror is tenant-scoped.

Account status changes are checked at every financial claim/write. Current privileged
administrative suspension does not share the household privacy lock; an overlapping
admin suspension and commit is a remaining operational race requiring a reviewed
account-wide lock protocol before a hosted financial runtime can activate. Ordinary
household unlink/owner changes and deletion fences use the shared privacy lock.

Activation outbox permission requires the same household's completed exchange and
persisted active Item, with exact aggregate/operation identity. Runtime authority
cannot invent an activation from a pending intent or redirect it to another aggregate.
A reopened local DB connection round-trips the persisted envelope using the original
isolated ephemeral keyring; this does not prove key persistence, KMS or process isolation.

### Runtime guard search-path hardening

Restricted-role negative controls demonstrated temporary-table shadowing of owner
checks and the document processing plan. All 30 reviewed `app` runtime guard functions
now place `pg_temp` explicitly last, preserving SECURITY INVOKER and existing grants.
A metadata-only additive migration checks the exact prior configuration and refuses
missing/definer/drifted functions. No table rows are rewritten at 100k households or
any other size; 5s lock/60s statement bounds apply. Do not serve between migration
steps. Rollback disables callers; reverting to the vulnerable path is not a safe rollback.
The two context readers contain no table lookup and remain unchanged. Runtime roles
must not have CREATE on either trusted schema. This protects guard resolution, not
arbitrary caller SQL, and is not a claim of immunity to a compromised database owner.
The [PostgreSQL search-path guidance](https://www.postgresql.org/docs/18/sql-createfunction.html)
explains why the temporary schema must be last. This mitigation is also necessary for
invoker guard functions when callers have the table mutation privileges the guards constrain.

### Durable local lifecycle increment (September 23, local only)

Migration `20260928000000_local_plaid_durable_lifecycle` completes the LOCAL deterministic
state machine after exchange. Every table is empty at migration, forced-RLS, household-scoped,
fixture-grammar constrained (`public-fixture-*`) and inventoried for deletion. No hosted
runtime, provider credential, KEK or real financial data is introduced.

- **Routing.** `plaid_local_item_routes` stores SHA-256(environment:provider Item ID).
  `Database.resolveFinancialItemRoute` is one fixed, callback-free query with no household
  or user GUC; the `plaid_route_lookup` policy (runtime role only) exposes exactly the row
  whose digest the caller already holds. Other roles are refused by privileges. The routed
  binding is re-checked inside the household scope before anything is written.
- **Verified inbox.** Only notices returned by the existing ES256/raw-body verifier are
  accepted. The inbox stores a closed signal (`transactions`/`item-status`) and the body
  digest, never the body. Pending exact duplicates coalesce; at most 32 pending per Item.
  Unknown codes refuse; unknown, removed or fenced Items receive the same acknowledgement.
  A signal only schedules a fresh provider read; it never writes state.
- **One operation lease per Item** (`plaid_local_cursors`): DB-time 60-second lease with the
  claimed cursor revision, credential revision and signal watermark captured by the trigger.
  Sync and rotation are reads and may be taken over after expiry; a stale token can never
  commit. Removal preempts reads but is single-attempt: an expired removal lease becomes
  `removal-indeterminate`, never a second provider call.
- **Atomic sync.** Bounded pagination (8 pages × 500 changes, 50 accounts) runs outside any
  transaction with Plaid's restart-from-original-cursor on mutation (3 READ restarts, never
  applied to credential operations). The collected batch is data: one transaction rechecks
  fence, bound owner/incarnation, Item state, credential revision, lease, exact cursor and
  revision, then upserts accounts, applies collapsed added/modified/removed transactions,
  marks only signals received before the claim watermark applied, emits one closed
  `plaid.local_sync_committed {version,revision}` and advances the cursor. Missing event,
  unknown account, oversize or malformed data publishes nothing. Money is integer cents.
- **Status.** `login-required`/`revoked` are projected only from a current held read. Owner
  reconnect (update mode) writes a closed intent and requests a read; it cannot change the
  Item identity or credential. A request made during an in-flight read survives that read.
- **Rotation.** Compare-and-swap of Item and envelope revision N→N+1 together, sealed outside
  the transaction under the N+1 binding; the old binding no longer opens the new envelope.
- **Unlink/removal.** Owner unlink (closed intent in the same transaction) fences reads at
  once. Outcomes stay distinct: `provider-acknowledged`, established `provider-invalid`, or
  `removal-indeterminate` (custody kept for reconciliation). Custody is destroyed in the
  same transaction as removal evidence, and only then (audited `plaid_local_credentials.delete`).
  Reconciliation is a non-mutating read that can only establish absence; a still-present Item
  needs an explicit new owner request. Local custody destruction is never provider deletion
  evidence and no final deletion receipt exists.
- **Deletion fence.** A fenced household admits only erasure-direction removal (implicit
  unlink, no owner requirement, audit rows but no outbox); a completed deletion refuses all.

Authority changes (all reviewed in the posture diff): the runtime role gains column UPDATE on
Item state/revision/evidence and credential envelope columns, credential DELETE, and scoped
rights on the five new tables; `app_user` gains only Item `state` (unlink) and cursor
`refresh_requested` (reconnect), each trigger-guarded and intent-bound, plus safe account/
transaction projections without provider IDs. `guard_plaid_effect` now permits runtime audit
rows for Item/cursor/custody under a fence. Existing insert-time exchange guards and commit
checks are unchanged but now fire on INSERT only. 12 new invoker functions pin `pg_temp` last;
no SECURITY DEFINER, no BYPASSRLS, no new role.

Deliberate limits: derived account/transaction retention after unlink is an **undecided
product policy**, so records are retained (never silently deleted or re-synced) until PRD
change control decides; export classifies them under the existing `provider-data` omission.
Sync is audited per committed operation (cursor revision), not per transaction row. The
administrative suspension race, operational KEK custody, hosted process isolation, provider
Sandbox lifecycle evidence, consent UI and ADR-019 restore admission remain launch blockers.
