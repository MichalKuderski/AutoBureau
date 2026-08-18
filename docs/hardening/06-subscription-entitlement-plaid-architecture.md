# AutoBureau — Subscription, Entitlement, Billing & Plaid Architecture Review

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Scope:** Read-only assessment + recommended architecture. **Nothing implemented.**

---

## The five things this document keeps separate

You asked that these not be conflated. They are distinct systems with different owners,
different failure modes, and different lifetimes:

| # | System | Question it answers | Source of truth |
|---|---|---|---|
| 1 | **Billing provider** | Has money changed hands? | Stripe |
| 2 | **Payment state** | Is this subscription paid, past-due, or cancelled? | Stripe → mirrored locally |
| 3 | **Entitlement state** | What is this household allowed to do, right now? | **AutoBureau's own database** |
| 4 | **Feature access** | Is this specific request permitted? | Server-side check at the API boundary |
| 5 | **Plaid connectivity** | Can we read this household's financial data? | Plaid — **and a separate concern entirely** |

**The single most important architectural statement in this document:** payment state and
entitlement state must never be the same field. Stripe is the authority on whether money
arrived. AutoBureau is the authority on what the household may do. They are connected by a
projection, not by an equals sign — because a household in a 7-day failed-payment grace period
is *unpaid but still entitled*, and that state is required by PRD §19 F14 ("failed payment →
7-day grace with banner, **never silent lockout**").

Plaid is not part of that chain at all. It is a data-ingestion channel that may later be
*gated by* entitlements. It is never the source of them.

---

# Part 1 — Existing-state assessment

### 1.1 What actually exists

| Element | Status | Evidence |
|---|---|---|
| **Subscription tiers** | **Schema only** | `PlanTier` enum (`free`/`premium`); `entitlements` table with `plan`, `docs_per_month`, `members_max`, `period_start`, `docs_used_this_period` |
| **Pricing logic** | **Hardcoded in a React component** | `billing-settings.tsx` `PLANS` const — violates PRD §19 F14's "prices/plans **configured, not hardcoded**" |
| **Billing provider** | **Not implemented** | Stripe appears **nowhere** in the codebase. The only `STRIPE` match is a CSS severity stripe in `obligation-card.tsx` |
| **Checkout flow** | **Not implemented** | "Upgrade" → `setPlan("premium")` + toast |
| **Subscription state** | **Local `useState`** | Lost on reload |
| **Cancellation** | **Not implemented** | `ConfirmDialog` → toast "Premium cancelled" |
| **Upgrade / downgrade** | **Not implemented** | Same local boolean |
| **Renewal** | **Absent** | No period rollover; `period_start` never advanced |
| **Failed payment** | **Absent** | No grace state exists in the enum or the schema |
| **Entitlement enforcement** | **Absent** | `docs_used_this_period` is **never read and never incremented** |
| **Feature gating** | **Absent** | No cap check anywhere in the codebase |
| **Server vs client enforcement** | **Neither** | Usage meter shows a hardcoded `docsUsed = 7` |

### 1.2 The one thing that *is* correct

`entitlements` is read exactly once — `(app)/layout.tsx:101` — to derive
`plan: "premium" | "free"` into `ActiveHousehold`. That read goes through `withHousehold`, so
it is RLS-scoped. **The plumbing from database → server component → provider is real.** The
table is also RLS-protected (`FORCE ROW LEVEL SECURITY`), keyed on `household_id` as its
primary key, which is the correct grain: entitlement belongs to the household, not the user.

### 1.3 Canonical source of truth: **there is none, and there are currently two contradictory ones**

This is the central existing-state finding. On the **same screen**, at the **same moment**:

- The sidebar renders `household.plan` — read from the `entitlements` table via RLS.
- The billing screen renders local `useState` — initialised to `"free"`, mutated by a button.

A user who clicks "Upgrade" sees the billing screen say **Premium** while the navigation says
**Free**. There is no reconciliation because there is no authority.

### 1.4 Pricing is inconsistent in four places

| Source | Price |
|---|---|
| PRD §5 F14 | Free / Premium **$12/mo or $99/yr** |
| `ops/assumptions.yaml` H2 experiment | **$6 / $12 / $99yr** (three price points under test) |
| `landing-screen.tsx:192` | **"$12 a month, or $99 a year"** |
| `billing-settings.tsx` | **$12/month only** — no annual option exists |

A user converting on the landing page's annual price cannot find it in the product.

### 1.5 Plaid: absent, and deliberately so

Exhaustive search: **zero occurrences** across `apps/`, `packages/`, `ops/`. This is not an
oversight. It is a documented, reasoned, multi-layer decision:

- **PRD §9 (postponed):** *"Plaid/transactions (v2, tied to monetization **ADR-011**)"* —
  and **ADR-011 does not exist**; the ADR set stops at 009.
- **`FOUNDING_PRINCIPLES` §11:** *"Not in version one, and not without an architecture decision
  record: Store credentials for government, bank, or utility portals… Move money."*
- **Strategy (red-team §1):** Rocket Money survived via *"found money… ingested automatically
  via Plaid — **the two exact things AutoBureau's v1 declines to do.**"*
- **Strategy (competitive §8), and this one matters:** *"CFPB 1033 enjoined & being rewritten —
  open-banking access may get fee-walled — a **threat to Plaid-dependent plays and a
  reprieve-window for us since v1 skips transactions**."* Skipping Plaid is a deliberate
  regulatory hedge.
- **doc 13 §7:** the launch subprocessor list includes Stripe (post-launch). **Plaid is not on
  it.** Adding a subprocessor requires an ADR plus a 30-day customer notice cycle.

**An important nuance, stated precisely:** Plaid does **not** violate the keel *as written*.
Plaid Link sends bank credentials to Plaid, never to AutoBureau; AutoBureau holds a Plaid
`access_token`, which is an API credential for a data aggregator, not a bank login. Read-only
transaction access does not move money. So the objection to Plaid is **not** a safety
prohibition — it is a **scope and sequencing decision** (PRD §9), reversible through §21. I
want to be exact about this because "Plaid is forbidden" would be the wrong summary and would
misdirect the decision.

### 1.6 The fact that should govern this entire phase

`ops/assumptions.yaml` **H2**:

> *"Standalone willingness to pay of $8–12/month exists in the target wedge, **without a
> found-money anchor**."*
> `category: existential · confidence: low · status: untested · validates_at: G1`

Read that phrasing carefully. **The company is deliberately testing whether it can monetize
without Plaid.** G1 — roughly seven days out — resolves it, and G1's own definition is
"kill / re-roll / proceed."

That single line determines the correct answer to Part 3 and Part 4, and I return to it there.

---

# Part 2 — Recommended entitlement architecture

## 2.1 The three-layer model

```
   STRIPE (external authority on money)
        │  webhooks (signed, idempotent, replayable)
        ▼
┌───────────────────────────────────────────────────────────────┐
│ LAYER 1 · SUBSCRIPTION STATE   — a mirror, never a decision   │
│   subscriptions: provider ids, status, period, cancel_at      │
│   Written ONLY by the webhook consumer. Never by a UI action. │
└───────────────────────┬───────────────────────────────────────┘
                        │  pure, deterministic projection
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ LAYER 2 · ENTITLEMENT STATE    — what the household MAY do    │
│   entitlements: plan, caps, usage, period, grace_until        │
│   AutoBureau's own truth. Survives Stripe being unreachable.  │
└───────────────────────┬───────────────────────────────────────┘
                        │  checked at the boundary, every request
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ LAYER 3 · FEATURE ACCESS       — may THIS request proceed?    │
│   requireEntitlement(ctx, "document.process") at /v1          │
│   AI gateway enforces the model-spend cap separately (§14)    │
└───────────────────────────────────────────────────────────────┘
```

**Why the projection must be explicit rather than implicit:** the mapping from
`subscription.status` to entitlement is *product policy*, not billing mechanics, and it is where
PRD §19 F14's requirements actually live. `past_due` maps to "premium caps, grace banner shown,
7-day timer running" — not to "free". Encoding that as a function over Layer 1 makes it
testable in isolation, which a scattered set of `if (plan === 'premium')` checks never is.

**Why Layer 2 must survive Stripe being down:** entitlement is read on the hot path of every
authenticated page render. If a Stripe outage could downgrade every household, a vendor
incident becomes a product-wide lockout. Layer 2 is a local table; Stripe's availability
affects *transitions*, never *current state*.

## 2.2 Required state transitions

| Event | Layer 1 (subscription) | Layer 2 (entitlement) | User-visible |
|---|---|---|---|
| **Upgrade** | `active`, period set | Premium caps **immediately** on `checkout.session.completed` | Caps lift ≤ 60 s (PRD §19 F14) |
| **Downgrade** | `cancel_at_period_end = true` | **Unchanged until period end** | "Premium until {date}" |
| **Payment fails** | `past_due` | **Premium caps retained**, `grace_until = now + 7d` | Banner. **Never silent lockout** (PRD §19 F14) |
| **Grace expires** | `unpaid`/`canceled` | Free caps; **data never deleted** | "Your plan has ended" |
| **Subscription expires** | `canceled` | Free caps at period end | Access through period end |
| **User cancels** | `cancel_at_period_end = true` | Unchanged until period end | One click, confirmation, **no retention maze** |
| **Plan change (mo↔yr)** | New price, same subscription | Caps unchanged; period boundary moves | Proration handled by Stripe |
| **Reconnect / re-subscribe** | New or reactivated subscription | Premium restored; **usage counters NOT reset** — see below | Immediate |

**Two decisions worth flagging as deliberate:**

*Downgrade does not take effect immediately.* The user paid for the period. PRD §19 F14 says
"access through period end." This means `cancel_at_period_end` must be a first-class field, not
inferred.

*Re-subscribing must not reset `docs_used_this_period`.* Otherwise cancel-and-resubscribe is a
free cap reset. The usage period is keyed on the **entitlement period**, not the subscription
lifecycle.

## 2.3 Webhook behaviour — delayed, duplicated, out-of-order

These are not edge cases; they are the normal operating condition of any webhook system.

| Condition | Required behaviour | Mechanism |
|---|---|---|
| **Delayed delivery** | Checkout must not depend on the webhook for the user's immediate experience | On checkout return, read the session from Stripe **synchronously once** and project; the webhook later confirms idempotently |
| **Duplicate delivery** | Second delivery is a no-op | Persist `stripe_event_id` with a **unique constraint**; insert-first, process-only-if-inserted |
| **Out-of-order delivery** | An older event must never overwrite newer state | Store `event_created_at`; **reject any event older than the last applied** for that subscription |
| **Missed entirely** | System self-heals | Periodic reconciliation job reading Stripe as truth |
| **Replay attack** | Rejected | Verify Stripe signature **before** parsing; enforce timestamp tolerance |
| **Processing failure** | Retried safely | Return non-2xx so Stripe retries; all handlers idempotent |

**Architecturally, the webhook endpoint should do almost nothing:** verify signature → insert
event row (unique on `stripe_event_id`) → `outbox.emit()` → return 200. Projection happens in
the consumer. This is exactly the pattern ADR-005 already mandates, and it means a slow
projection can never cause Stripe to time out and retry-storm.

**Note the dependency:** this requires the outbox **dispatcher**, which does not exist —
`packages/db/src/outbox.ts` exports only `emit()`, with no claim query or publish loop.
Webhook handling is therefore blocked on the same infrastructure as reminders.

## 2.4 Where enforcement belongs

PRD §19 F14 requires caps "enforced **server-side (gateway + API)**". That is two points, and
they are different:

1. **API boundary** — countable resources (documents processed, members). A capability-style
   check alongside the existing `can()`: `requireEntitlement(ctx, "document.process")`,
   returning the already-defined `402 cap-exceeded` problem kind.
2. **AI gateway (ADR-006)** — per-household daily model budget (PRD §14). A different meter
   with a different remedy: queue rather than reject.

**Client-side gating is presentation only.** The UI may hide or soften an action; it must never
be the check. `ActiveHousehold.plan` is fine for rendering a badge — it must not be the reason a
request is allowed.

**Usage counting must be transactional.** Incrementing `docs_used_this_period` in the same
`withHousehold` transaction as the document write is the only way the counter cannot drift, and
it costs nothing given the existing scoped-client design.

---

# Part 3 — Recommended Plaid architecture

## 3.1 Recommendation: design the seam, build nothing

**Do not implement Plaid in this hardening phase.** Not because it is forbidden — as
established in §1.5, it is not — but because:

1. **It is gated by process:** PRD §21 amendment + ADR-011 (which the PRD names and which does
   not exist) + subprocessor addition with a 30-day notice cycle.
2. **It is gated by evidence:** H2 explicitly tests monetization *without* a found-money anchor,
   and G1 resolves that in ~7 days. Building Plaid before G1 pre-commits the company to the
   answer it is about to buy.
3. **It is gated by strategy:** v1 skipping transactions is a documented regulatory hedge
   against CFPB 1033 being fee-walled.
4. **Most importantly:** AutoBureau currently has no household creation, no document storage,
   no ingestion pipeline, and no billing. Plaid is the *ninth* most valuable thing to build.

**But the seam is worth defining now, because it costs nothing and prevents a later mess.**

## 3.2 If and when it is built: the isolation boundary

Plaid should enter as a **connector module behind the same shape as any other ingestion
channel** — the product already has this concept (upload, email forward, and a planned Gmail
OAuth). It is a source of *facts*, not a new subsystem.

```
Browser ── Plaid Link (Plaid's JS, Plaid's UI) ─────► Plaid
   │  Bank credentials go here. NEVER to AutoBureau.
   │  Returns: public_token (short-lived, single-use)
   ▼
POST /v1/integrations/plaid/exchange   { public_token }
   │  server-side exchange
   ▼
Plaid API → access_token + item_id
   │
   ▼
 plaid_items  (access_token ENCRYPTED at rest, ADR-007 envelope)
   │
   ▼
 outbox → dispatcher → sync worker ──► normalized facts
                                        (subscriptions/recurring charges,
                                         NOT a general transaction ledger)
```

**Design constraints, each with a reason:**

| Constraint | Why |
|---|---|
| `access_token` **never** leaves the server; encrypted at rest via ADR-007 | It is a long-lived credential to a household's financial data — the most sensitive value in the system |
| The AI runtime holds **no decrypt grant** for it | Same rule already applied to `item_secrets` (ADR-007) |
| Plaid data is **read-only**; no payment initiation, no transfer scopes | The keel: "Move money" stays prohibited |
| Request the **minimum products** — `transactions` only, and only if recurring-charge detection is the use case | Scope creep here is a privacy liability, not a feature |
| Sync runs **in the dispatcher**, never in a request | `withHousehold` forbids network I/O inside a scoped transaction |
| Derived facts carry **provenance** (`source='plaid'`, confidence, item id) | FOUNDING_PRINCIPLES invariant 7 — same rule as AI-derived rows |
| Plaid failure **never** degrades core product | Documents, obligations, and reminders must work with every Plaid item broken |

## 3.3 Connection lifecycle

| State | Meaning | Product behaviour |
|---|---|---|
| `pending` | Link started, not exchanged | Transient |
| `active` | Healthy | Normal sync |
| `login_required` | Re-auth needed (`ITEM_LOGIN_REQUIRED`) | Banner + Link update mode. **Never silent** |
| `error` | Institution or Plaid fault | Retry with backoff; surface after repeated failure |
| `revoked` | User disconnected at bank or in-product | Stop syncing; **delete `access_token` immediately** |
| `disconnected` | User removed in AutoBureau | Call `/item/remove` at Plaid, then purge |

**Webhooks to honour** (minimum viable set — resist more):
`SYNC_UPDATES_AVAILABLE` (incremental sync), `ITEM_LOGIN_REQUIRED` (re-auth), `ITEM_ERROR`,
`USER_PERMISSION_REVOKED`, `PENDING_EXPIRATION`. Same envelope discipline as Stripe: verify,
dedupe on event id, emit to outbox, project in a consumer.

**Consent and privacy** (doc 13 §3 already names the pattern — just-in-time notices at
sensitive moments): an explicit just-in-time notice before Link opens stating what is read,
what is not, how to disconnect, and what happens to the data on disconnect. Plaid must be added
to the public subprocessor list with the 30-day notice. Disconnection must purge derived
financial facts, not merely stop syncing — otherwise "disconnect" is a lie of the same species
this audit has been cataloguing.

## 3.4 What Plaid must NOT become

- Not an authentication method.
- Not a source of entitlement or payment state (Stripe owns that; the two are unrelated).
- Not a general transaction ledger — that is Rocket Money's product, and the strategy documents
  are explicit that "found money is an *anchor*, not a company."
- Not a dependency of any core flow.

---

# Part 4 — Subscription tiers × Plaid

**You asked me not to invent product requirements silently. Almost every cell below is an open
product decision, and I am marking them as such rather than filling them in.**

The only tier facts with documentary support are PRD F14's: Free = 10 documents/month + 1 elder
member; Premium = $12/mo or $99/yr. **Nothing in the PRD, the ADRs, the strategy documents, or
the assumption registry says anything about Plaid limits per tier** — because Plaid is v2 and
ADR-011 is unwritten.

| Dimension | Documented? | Assessment |
|---|---|---|
| **Plaid availability by tier** | ❌ **OPEN** | My recommendation, offered as input not decision: Premium-only. Plaid carries per-item vendor cost, so a free tier with Plaid inverts the unit economics the PRD caps at $1.10/household/month (X5: >$1.60 triggers a routing sprint before feature work) |
| **Number of linked institutions** | ❌ **OPEN** | Any cap is a cost-control decision requiring real Plaid pricing. Do not guess |
| **Number of connected accounts** | ❌ **OPEN** | Likely unnecessary — institution count is the cost driver, account count mostly is not |
| **Data refresh frequency** | ❌ **OPEN** | Webhook-driven sync is cheaper than polling; tiering frequency may be solving a problem that does not exist |
| **Supported financial features** | ❌ **OPEN** | Depends entirely on whether Plaid arrives as "recurring-charge detection" or something broader — an ADR-011 question |
| **Household member access** | ⚠️ **PARTIAL** | The role model exists (`owner`/`member`/`viewer`, 10 capabilities). Financial connections plausibly need `owner`-only linking with member visibility — but PRD §9 postpones multi-user to v1.x, so this is downstream of the identity audit |

**A caution about the shape of this question.** Tiering Plaid dimensions presumes Plaid is a
premium *feature*. The strategy documents suggest a different framing entirely: for Rocket
Money, Plaid was the **ingestion substrate** that made the product work, not an upsell. If G1
sends AutoBureau toward the found-money re-roll, Plaid would plausibly be table stakes on every
tier and the tiering would happen elsewhere. **Deciding the tier matrix before ADR-011 decides
Plaid's role would be answering the second question first.**

---

# Part 5 — Recommended database entities

Additive only. No existing table is reshaped.

```prisma
// ── LAYER 1 · mirror of Stripe. Written only by the webhook consumer. ──
model Subscription {
  householdId          String    @id @map("household_id") @db.Uuid
  provider             String    @default("stripe")
  customerRef          String    @map("customer_ref")        // Stripe customer id
  subscriptionRef      String?   @unique @map("subscription_ref")
  priceRef             String?   @map("price_ref")           // which configured price
  status               SubStatus                              // mirrors Stripe verbatim
  currentPeriodEnd     DateTime? @map("current_period_end") @db.Timestamptz(6)
  cancelAtPeriodEnd    Boolean   @default(false) @map("cancel_at_period_end")
  // Ordering guard: reject any event older than this.
  lastEventAt          DateTime? @map("last_event_at") @db.Timestamptz(6)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  @@map("subscriptions")
}

enum SubStatus { trialing active past_due unpaid canceled incomplete }

// ── Webhook dedupe. The unique constraint IS the idempotency mechanism. ──
model WebhookEvent {
  id             BigInt   @id @default(autoincrement())
  provider       String                                       // "stripe" | "plaid"
  externalId     String   @map("external_id")
  eventType      String   @map("event_type")
  eventCreatedAt DateTime @map("event_created_at") @db.Timestamptz(6)
  receivedAt     DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
  processedAt    DateTime? @map("processed_at") @db.Timestamptz(6)
  payload        Json

  @@unique([provider, externalId])          // duplicate delivery → insert fails → no-op
  @@index([provider, processedAt])
  @@map("webhook_events")
}

// ── LAYER 2 · EXTEND the existing entitlements table. Do not replace it. ──
// Additions only:
//   graceUntil       DateTime?  @map("grace_until")   -- the 7-day failed-payment window
//   periodEnd        DateTime?  @map("period_end")    -- usage period, distinct from billing
//   source           String     @default("default")   -- "default" | "stripe" | "manual"
//   plaidItemsMax    Int?       @map("plaid_items_max") -- ONLY once ADR-011 exists

// ── Idempotency for /v1 writes (architecture review W9) ──
model IdempotencyKey {
  key          String   @id
  householdId  String   @map("household_id") @db.Uuid
  requestHash  String   @map("request_hash")   // canonical hash — packages/contracts has it
  responseBody Json?    @map("response_body")
  status       Int?
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([createdAt])
  @@map("idempotency_keys")
}

// ── PLAID · DO NOT CREATE UNTIL ADR-011 EXISTS. Shape recorded for review only. ──
// model PlaidItem {
//   id, householdId, itemIdRef, institutionRef, institutionName,
//   accessTokenCiphertext Bytes, keyVersion Int,     // ADR-007 envelope
//   status PlaidItemStatus, lastSyncedAt, cursor, consentExpiresAt
//   @@unique([householdId, itemIdRef])
// }
```

**Why `plan` stays on `entitlements` rather than moving to `subscriptions`:** entitlement is
read on every authenticated page render. Keeping it on the table the layout already reads
avoids adding a join to the hottest path, and preserves the property that entitlement survives
Stripe being unreachable.

**RLS:** every new household-scoped table gets `FORCE ROW LEVEL SECURITY` with the standard
`household_id = app.current_household()` policy. `webhook_events` is **not** household-scoped —
it is dispatcher-owned infrastructure, like `outbox_events`, and must be readable only by
`app_dispatcher`.

---

# Part 6 — Required API boundaries

All under the existing `authenticated()` wrapper, which needs no change.

| Endpoint | Capability | Notes |
|---|---|---|
| `GET /v1/entitlements` | `registry.read` | Current plan, caps, usage, grace state. The single source the UI renders |
| `POST /v1/billing/checkout` | `settings.manage` | Creates a Stripe **hosted** Checkout session, returns URL. Owner-only |
| `POST /v1/billing/portal` | `settings.manage` | Stripe Billing Portal session — cancellation, payment method, plan change all live here |
| `GET /v1/billing/plans` | `registry.read` | **Configured**, not hardcoded (PRD §19 F14) |
| `POST /webhooks/stripe` | **none — public, signature-verified** | Not under `/v1`; no session, no CSRF. Signature is the authentication |

**Deliberately absent:** no `POST /v1/billing/cancel`, no `POST /v1/billing/upgrade`. Routing
cancellation through Stripe's hosted portal satisfies PRD's one-click, no-retention-maze
requirement *and* keeps AutoBureau out of PCI scope (doc 13 §1: "future payments only via
Stripe-hosted surfaces (SAQ-A)"). Building a bespoke cancellation endpoint would add
liability for no product gain.

**Plaid endpoints — not to be created until ADR-011:**
`POST /v1/integrations/plaid/link-token` · `POST /v1/integrations/plaid/exchange` ·
`DELETE /v1/integrations/plaid/items/{id}` · `POST /webhooks/plaid`.

**The webhook routes need a middleware allowlist entry.** `public-routes.ts` is an exact-match
list by design; `/webhooks/stripe` must be added deliberately, and this is a security decision
requiring review — signature verification replaces session authentication there.

---

# Part 7 — Failure and retry model

| Failure | Behaviour | Rationale |
|---|---|---|
| Stripe unreachable at checkout | Show a retry surface; entitlement unchanged | Layer 2 is local; no downgrade |
| Webhook delayed | Checkout return reads the session synchronously once | User sees the upgrade immediately |
| Webhook duplicated | Unique constraint rejects; no-op | Insert-first, process-if-inserted |
| Webhook out of order | Reject events older than `lastEventAt` | Prevents an old `past_due` overwriting a new `active` |
| Webhook never arrives | Reconciliation job reads Stripe | Self-healing without manual intervention |
| Projection fails | Return non-2xx; Stripe retries with backoff | Handlers idempotent |
| Payment fails | `past_due` → grace 7 days, **caps retained**, banner | PRD §19 F14: never silent lockout |
| Grace expires | Free caps; **no data deleted** | Deletion is a separate, explicit user action |
| Plaid item errors | Backoff; surface after repeated failure; core product unaffected | Failure isolation |
| Plaid re-auth needed | Banner + Link update mode | Never silent staleness |

**Two invariants worth stating explicitly:**

*Entitlement never degrades as a side effect of a vendor outage.* Only an explicit, verified
state transition changes what a household may do.

*A cap rejection is never a data loss.* A document over cap should be **stored and queued**,
not refused — PRD §19 F14 requires messaging *before* a hard stop, and losing a user's passport
scan because they hit a counter would be the worst possible expression of a billing rule.

---

# Part 8 — Tier-by-tier feature matrix

**Only the first two rows are documented. Everything below the line is an open decision.**

| Capability | Free | Premium | Source |
|---|---|---|---|
| Documents processed / month | **10** | Unlimited* | ✅ PRD F14 |
| Elder members | **1** | Household | ✅ PRD F14 |
| Price | $0 | **$12/mo or $99/yr** | ✅ PRD F14 (pricing amendable by G1 — §4.1 clause) |
| ─────────────── | ─── | ─── | ─── |
| Obligation tracking | ? | ? | ❌ OPEN — the landing page implies Free includes deadline reminders |
| Reminder channels | ? | ? | ❌ OPEN — `billing-settings.tsx` invents "email only" vs "email, push, calendar". **Not in the PRD** |
| Warranty/deposit tracking | ? | ? | ❌ OPEN — invented by the same component |
| Priority document review | ? | ? | ❌ OPEN — invented by the same component |
| Export / deletion | **Both tiers** | Both | ✅ FOUNDING_PRINCIPLES invariant 10 — never gate these |
| Plaid availability | — | ? | ❌ **OPEN — requires ADR-011** |
| Linked institutions | — | ? | ❌ OPEN |
| Refresh frequency | — | ? | ❌ OPEN |

*\*"Unlimited" needs a fair-use ceiling given the $1.10/household/month COGS model (PRD X5).
An unbounded cap on an AI-metered product is an unbounded cost.*

**Finding:** four of the feature rows currently shown to users in `billing-settings.tsx` —
reminder channels, warranty/deposit tracking, priority review — **appear nowhere in the PRD**.
They were invented in a React component and are being presented to users as the plan's terms.
That is a product-scope decision made in the UI layer, and it should either be ratified into
the PRD or removed.

---

# Part 9 — Open product decisions

Numbered for tracking. None should be resolved by an engineer in a component file.

| # | Decision | Blocks | Owner |
|---|---|---|---|
| **OD-1** | Does G1 validate H2 (WTP without a found-money anchor)? | Everything below | Founder / G1 |
| **OD-2** | Final pricing: PRD says $12/$99; H2 tests $6/$12/$99; code shows two different things | Plan configuration | Founder, post-G1 |
| **OD-3** | Is there an annual plan in-product? Landing sells one; billing screen has none | Checkout | Product |
| **OD-4** | What is "unlimited" in practice, given the COGS cap? | Cap enforcement | Product + Finance |
| **OD-5** | Ratify or remove the four invented Premium features | Billing UI | Product |
| **OD-6** | Does Plaid return to scope at all? (PRD §21 amendment) | All Plaid work | Founder, post-G1 |
| **OD-7** | If yes: is Plaid an ingestion substrate or a premium feature? | Tier matrix | ADR-011 |
| **OD-8** | Free-trial policy — none is specified anywhere | Checkout | Product |
| **OD-9** | What happens to over-cap documents: queued or refused? | Pipeline | Product (recommend queued) |
| **OD-10** | Who may manage billing — `owner` only? | Capability matrix | Product (recommend owner-only) |

---

# Part 10 — Implementation dependencies

```
Household creation ──────────► entitlement row must exist per household
   (identity audit)                    │
                                       ▼
Outbox dispatcher ──────────► webhook projection, reconciliation
   (does not exist)                    │
                                       ▼
Observability ──────────────► payment failures must be visible
   (does not exist)                    │
                                       ▼
Plan configuration ─────────► "configured, not hardcoded" (PRD §19 F14)
                                       │
                                       ▼
Stripe integration ─────────► checkout · portal · webhooks
                                       │
                                       ▼
Document pipeline ──────────► something to actually meter
                                       │
                                       ▼
Cap enforcement ────────────► 402 + 80% warning
                                       │
                                  [ G1 · ADR-011 ]
                                       ▼
                                  Plaid (contingent)
```

**Blocking today:** no household creation (so no entitlement row can exist), no outbox
dispatcher (so no webhook projection), no observability (so a failed payment is invisible), no
document pipeline (so there is nothing to meter).

**Billing cannot be built first.** It is downstream of the identity lifecycle and the
dispatcher, both of which the architecture review already ranked P0.

---

# Part 11 — Recommended implementation order

**Phase 0 — before G1 (cheap, honest, zero-risk).** No backend required.
1. Make the billing screen read `household.plan` — removes the two-contradictory-sources defect.
2. Remove the fake upgrade/cancel actions and the hardcoded `docsUsed = 7`.
3. Ratify or remove the four invented feature rows (OD-5).
4. Reconcile the pricing shown on the landing page with the product (OD-2/OD-3).

**Phase 1 — after G1 says "proceed", and only then.**
5. Plan configuration (not hardcoded) — PRD §19 F14.
6. Entitlement row created with every household (depends on identity audit).
7. `GET /v1/entitlements` + server-side cap check returning `402`, with the 80% warning.
8. Transactional usage counting in the same `withHousehold` transaction as the document write.

**Phase 2 — Stripe.**
9. Webhook endpoint: verify → dedupe → outbox → 200 (depends on dispatcher).
10. Subscription mirror + the projection function, tested in isolation.
11. Hosted Checkout + Billing Portal.
12. Reconciliation job.

**Phase 3 — contingent on OD-6 and ADR-011.**
13. Plaid, as an isolated connector module, if the amendment passes.

---

# Part 12 — Security and privacy considerations

| Concern | Requirement |
|---|---|
| **PCI scope** | Stripe-hosted surfaces only (Checkout + Portal) → SAQ-A. **Never** accept card data. doc 13 §1 |
| **Webhook authenticity** | Verify the signature **before** parsing the body. Raw body required — note Next.js route handlers must not pre-parse |
| **Webhook route exposure** | `/webhooks/stripe` must be added to the exact-match public allowlist deliberately; signature replaces session auth |
| **Plaid `access_token`** | Encrypted at rest (ADR-007), server-only, never logged, no decrypt grant for the AI runtime |
| **Plaid consent** | Just-in-time notice before Link; subprocessor list updated with 30-day notice (doc 13 §7) |
| **Disconnection** | Must call Plaid `/item/remove` **and** purge derived facts — not merely stop syncing |
| **PII in financial data** | Account numbers are identifier-grade → `item_secrets`, never `attrs`, logs, prompts, or search |
| **Billing PII** | Stripe holds card data; AutoBureau stores only opaque provider references |
| **Audit** | Every plan and entitlement transition writes an audit row — the actor is DB-stamped, so this is nearly free |
| **Enumeration** | Billing errors must not reveal whether a customer record exists |
| **Deletion cascade** | Account deletion must cancel the Stripe subscription and remove Plaid items, or the user keeps being charged for a deleted account |

---

## Closing recommendation

**Build the entitlement architecture; defer the billing integration; do not build Plaid.**

The entitlement model is worth defining now because it is PRD-specified, it is needed regardless
of what G1 says, and its absence is currently producing a screen that contradicts itself. Most
of Phase 0 is deletion.

Stripe is well specified and genuinely blocked — on household creation, the outbox dispatcher,
and observability. Attempting it earlier means building a webhook consumer with no dispatcher
and no logging, which is how silent payment-state drift begins.

Plaid should not be built, and the reason is not that it is forbidden — it is not, and calling
it forbidden would misdirect the decision. It is that **H2 is deliberately testing whether this
company can monetize without it, and that test resolves in about a week.** Building Plaid now
would spend the answer before buying it.

The one Plaid action worth taking today is architectural hygiene that costs nothing: keep
ingestion channel-shaped, so that if ADR-011 is eventually written, Plaid arrives as a
connector and not as a refactor.
