# Local TEST reconciliation boundary

The pinned official Stripe SDK is 22.6.2. Its TypeScript definitions target Dahlia;
Pellum explicitly requests `2026-02-25.clover` and validates a closed runtime
projection. SDK automatic retries are disabled. Only TEST key classes are accepted;
all objects with a livemode field must be false. Tests use the SDK's injected HTTP
client, not a provider account. No key, customer or charge is created.

Authenticated refetch independently checks account, customer, subscription and
latest invoice, verifies price/product against the server catalog, and verifies any
different invoice named by an older notice. Customer/subscription association is
not derived from metadata. Subscription AND invoice are read again; projection
disagreement refuses. Three sequential phases of parallel bounded reads fit the
existing sixty-second claim budget. This is not an atomic Stripe snapshot and
cannot prevent a provider mutation after the last read.

Current local domain decision: active paid period -> active; scheduled cancellation
-> canceling through the paid boundary; canceled -> no access; existing paid period
then past_due -> at most seven days after that paid boundary. Delayed/repeated
notices do not restart grace. First unpaid invoice, incomplete/expired/unpaid/paused
or unapproved trial -> no grant. No browser success page or arrival time is used.
Failed upgrades retain the previously paid plan during grace; scheduled cancellation caps it. The proposal is now serialized and persisted locally under lease fencing, without activating application entitlements.

Local migration 24 adds a TEST state journal. A transaction-scoped advisory lock
serializes claims for the exact immutable binding; an active durable notice lease
keeps exclusion after the transaction closes. The invoker SQL trigger independently
refuses overlapping claims, including raw SQL. Hash collisions cause refusal only.
No connection/lock is held during provider I/O. Completion rechecks current owner,
privacy fence, notice/token/DB-clock expiry and expected state revision. State,
terminal notice, trigger audit and opaque `billing.test_state_reconciled` outbox fact
commit atomically. The analytics route is registered; no hosted consumer is enabled.
A crash after commit is terminal and cannot repeat effects; a crash before commit
leaves an expiring claim bounded to three attempts. Failure evidence is kept.

The app role can read only the safe state projection, not the source lease or
provider account IDs. Privacy workers can inventory only row/household IDs. No role,
provider grants, entitlement-write grant or SECURITY DEFINER function is added.
Deletion fences stop reads/commits; state joins the erasure inventory without purge.
The database-clock eligibility read denies elapsed periods even without a worker,
but is diagnostic only and is intentionally absent from routes and cap gateways.

Remaining implementation gates: dedicated billing runtime authority rather than
putting provider credentials on the generic document/job worker; reviewed cap
catalog; authoritative entitlement state plus read-time expiry in every cap gateway;
missed-webhook reconciliation intent; checkout/portal/customer establishment;
provider TEST lifecycle evidence and UI. Existing `entitlements` are unchanged.
The local decision journal is not an activated Premium authorization mechanism.

[Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks),
[Clover subscription](https://docs.stripe.com/api/subscriptions/object?api-version=2026-02-25.clover)
and [invoice](https://docs.stripe.com/api/invoices/object?api-version=2026-02-25.clover)
references inform the adapter. No Live mode, trial offering, money movement or
financial advice is introduced. Production preflight remains NO-GO.
