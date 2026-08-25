# ADR-013 — Authentication rate limits live in Postgres, reached by one narrow anonymous path

**Status:** Proposed · blueprint P1-08. **Not to be marked Accepted until the implementation is reviewed.**
**Date:** 2026-08-25
**Narrows, does not overturn:** the store named in `12-security.md` §7 ("Upstash sliding-window"),
and the anonymous fail-closed rule in `12-security.md` §7 / `01-system-architecture.md` §8 ("Redis
down") — **for this limiter only**. That fail-closed rule remains the governing default for
rate-limit infrastructure independent of the application, and this exception **lapses automatically**
if these counters ever move to such infrastructure (D7). ADR-005 is untouched: the outbox still
targets Redis Streams, which is a fan-out decision, not a counting one.
**Does not amend ADR-011.** D14 already makes `/v1/auth/*` a documented exception, and this ADR
lives entirely inside it.

## Context

`docs/hardening/01-current-state-ground-truth.md` §S5 states the gap: "Auth throttling is entirely
delegated to GoTrue." `provider.ts:88` maps a provider `429` to `rate-limited`, and
`sign-in/route.ts:129` and `magic-link/route.ts:73` render it — so the *handling* is complete and
the *enforcement* belongs to someone else, whose limits are unverified (`provider.ts:17-21`:
"PROVIDER COMPATIBILITY IS UNVERIFIED").

P1-08's preflight stopped before implementation because two questions had no governing answer.

**The store does not exist.** The blueprint says P1-08 "requires Redis (does not yet exist)". Redis
is still absent, and the audit is identical to the one ADR-012 ran three days ago:

| Checked at this commit | Result |
|---|---|
| Redis client dependency in any `package.json` | none — the sole hit is the `db:up` docker script |
| Occurrences of `redis` in `pnpm-lock.yaml` | **zero** — not a transitive dependency either |
| Code that opens a Redis connection | none — the three source hits are a redaction regex and two doc comments |
| `.env.example` classification of `REDIS_URL` | **"local only"**, beside `DATABASE_EXPECTED_MAJOR` |
| What `.env.example` says every deployed environment needs | `DATABASE_URL` + seven `AUTH_*`/`APP_ORIGIN` values; Redis is not among them |
| `docker-compose.yml` | runs `redis:7-alpine` for a laptop; header says production would use Upstash |
| `vercel.json`, `.github/workflows/deploy.yml` | provision nothing |
| `.github/workflows/ci.yml` services | Postgres only |

**And the database has no door.** This is the harder half, and it is new. `Database` exposes exactly
four entry points (`packages/db/src/scoped.ts`), and rate limiting runs before any of their
preconditions exist:

| Method | Requires | Why it cannot serve a limiter |
|---|---|---|
| `withPrincipal(userId)` | a validated user UUID | read-only by construction, and there is no user yet |
| `withHousehold(householdId)` | a validated household UUID | there is no household yet |
| `withIdentity(userId)` | a validated user UUID | exists specifically for `users`/`user_profiles` mirroring (ADR-009 D8); still needs a user |
| `unsafeAcrossAllHouseholds(reason)` | the `app_dispatcher` BYPASSRLS role | doc 06 §5 confines it to migrations and two named jobs; `ci.yml` fails the build if it appears outside `packages/db/src/scoped.ts` and `packages/db/tests/` |

`packages/db/src/index.ts` deliberately does not export the bare `PrismaClient` value, and CLAUDE.md
forbids constructing one in application code. A rate limiter on `POST /v1/auth/sign-in` runs before
a token has been verified: there is no principal, no household, and therefore no sanctioned way to
reach Postgres at all.

So P1-08 needs a storage decision *and* an access decision. Both are below.

## Decision

### D1 — The store is the application's own Postgres

Rate-limit counters are rows in a new `auth_rate_limits` table, in the same database the request
already depends on.

**Why not Upstash/Redis.** The reasoning is ADR-012's and it has not weakened:

- **It would make a mechanism task provision the company's first Redis.** A client library, a Doppler
  secret, a new per-environment variable, a new outage mode, and a new service in CI — acquired by
  the task whose job is to count failed logins. ADR-005 *intends* Redis for the outbox; that
  intention has not been executed, and P1-08 is not the place to execute it.
- **Doc 12 §7 named Upstash inside a design where Redis was already load-bearing.** The
  principal-panel review defended Redis on exactly that basis ("Redis is already load-bearing for
  rate limiting and idempotency"). One of those two has since moved to Postgres (ADR-012). Naming a
  store in a summary table is not the same as deploying one, and P1-08's own instruction is not to
  choose Redis merely because older text mentions it.
- **The atomicity is free here and bought there.** A fixed-window counter is
  `INSERT … ON CONFLICT DO UPDATE SET attempts = attempts + 1 RETURNING attempts` — one statement,
  one round trip, no read-modify-write race. Redis gives `INCR`, then needs its own answer for
  window boundaries and its own durability story.
- **Local and integration parity are free here and bought there.** `pnpm db:up` already starts
  Postgres; `ci.yml` already provisions it; the integration tier already runs against a real
  database with the two-connection discipline. The property most worth testing — that two concurrent
  increments produce two distinct counts — is provable at that tier today. A Redis-backed limiter
  would need either a second CI service or a fake, and **a fake proves nothing about atomicity**,
  which is the only hard part of a limiter.

**What choosing Postgres costs, stated plainly:**

- **Failed attempts become writes on the primary.** This is inherent to metering — an attacker's
  traffic has to cost something — but it is a write, and writes land on the primary. The cost is
  bounded by *distinct buckets*, not by attempts: a million guesses against one account are a
  million `UPDATE`s to **one row**, not a million rows. See D11.
- **Concurrent attempts against the same bucket serialize on one row lock.** For a stuffing run
  against a single account that is the desired behaviour, not a defect. Different subjects touch
  different rows.
- **Postgres has no TTL.** Expiry is a predicate plus opportunistic cleanup, exactly as
  `idempotency_keys` does it (D11).

**Failure modes** are D7's subject and are the reason this decision and that one have to be made
together.

**Reversible.** Nothing will reference the table and no domain row will point at it. If Redis is
later provisioned for the outbox (P1-13), moving these counters is a swap behind one module — but
the reason to do it would have to be measured contention, not tidiness.

### D2 — One new, narrowly typed method: `withGlobalTable`

`packages/db/src/scoped.ts` gains exactly one method. It is not an escape hatch and must never be
described as one.

```
withGlobalTable<T>(
  table: GlobalTable,                       // a closed union — today: "auth_rate_limits"
  fn: (tx: GlobalClient) => Promise<T>,
  options?: ScopedTransactionOptions,
): Promise<T>
```

**What it does not do, in the order these were ruled out:**

- It does **not** make `withPrincipal` writable. That method is read-only by construction because
  deciding which household a request belongs to is not a moment that should change rows, and
  widening it would remove a guard rather than add a capability.
- It does **not** make `withIdentity` generic. That method exists for one operation named in
  ADR-009 D8, and its audit unit relies on the `self_audit_insert` policy matching a principal it
  establishes. There is no principal here for that policy to match.
- It does **not** use `unsafeAcrossAllHouseholds`. That runs on `app_dispatcher` (BYPASSRLS). An
  auth request must never touch a connection that can see every household — the blast radius of a
  bug in a public, unauthenticated endpoint is the entire tenant set.
- It does **not** expose a `PrismaClient`. `packages/db/src/index.ts` keeps its promise.
- It is **not** a general unscoped API. The `table` argument is a closed union, so calling it for
  any other table is a **type error, not a code-review hope** — the same standard doc 06 §4 sets for
  household scoping.

**The central safety property, and it is structural rather than conventional:** `withGlobalTable`
sets **no GUC at all**. It deliberately establishes neither `request.household_id` nor
`request.user_id`. With both unset, `app.current_household()` and `app.current_user_id()` return
NULL, every household policy predicate evaluates to NULL, and **every household-scoped table returns
zero rows and rejects every write** — the fail-closed behaviour the RLS migration was built around.
A query issued through this method that named `items` or `documents` would not leak; it would return
nothing. The second wall does the work, so the method's narrowness is enforced by the database and
not only by its signature.

Three further properties:

- **Ordinary `app_user` connection.** Never `app_dispatcher`, never `service_role`. No BYPASSRLS
  anywhere near the request path.
- **No audit unit.** There is no actor. `audit_log` requires a household or the dispatcher role
  (`audit_insert` policy), so an audit row here would be both impossible to insert and wrong to
  want — a rate-limit decision is not a household-attributable domain action. D12's log record is
  the account of what happened.
- **The same short-transaction discipline.** Same `timeoutMs`/`maxWaitMs` defaults, one or two
  statements, and the standing prohibition on network I/O inside a scoped transaction applies
  unchanged. In particular the provider call happens *after* the limiter's transaction closes.
- **A distinct client type.** `GlobalClient` is not `ScopedClient` and not `DispatcherClient`, so
  the three cannot be passed interchangeably by accident.

**How CI prevents this capability from spreading.** Three fences, in decreasing strength:

1. **The union type, checked by `pnpm typecheck`, which CI already runs.** A call naming a table
   outside the union does not compile. This is the primary fence and the only one that cannot be
   worked around by writing the call differently.
2. **A grep fence in `ci.yml`**, mirroring the existing `unsafeAcrossAllHouseholds` step:
   `withGlobalTable` may appear only in `packages/db/src/scoped.ts`, the limiter module, and tests.
   Any other file fails the build. This catches the case the type system cannot — a *new* caller
   for the *allowed* table, somewhere it does not belong.
3. **A grep fence pinning the union's membership.** The guardrail step names the tables it expects
   the union to contain. Adding a member to `GlobalTable` therefore fails CI until the same PR
   updates the fence, which makes widening the capability an explicit, reviewable act rather than a
   one-line diff nobody notices.

The two existing fences (`service_role`, `unsafeAcrossAllHouseholds`) are untouched.

### D3 — Storage model: fixed-window counters, one row per bucket per window

Conceptual shape of `auth_rate_limits`. **No migration is written by this ADR.**

| Column | Type | Purpose |
|---|---|---|
| `id` | `UUID` PK, `gen_random_uuid()` | consistent with `idempotency_keys` |
| `policy` | `VARCHAR(64)` NOT NULL | the policy identifier — `sign_in.identifier`, `sign_in.identifier_ip`, `sign_in.ip`, `magic_link.identifier`, `magic_link.ip` |
| `bucket` | `CHAR(64)` NOT NULL | SHA-256 hex of the normalized subject, scoped by policy — **never a raw email or IP** |
| `window_started_at` | `TIMESTAMPTZ` NOT NULL | request time floored to the policy's window length |
| `attempts` | `INTEGER` NOT NULL DEFAULT 0 | the counter |
| `expires_at` | `TIMESTAMPTZ` NOT NULL | `window_started_at + window`; authoritative for expiry (D11) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | ordinary bookkeeping |

- **`UNIQUE (policy, bucket, window_started_at)`** is what makes the increment atomic. A single
  `INSERT … ON CONFLICT (policy, bucket, window_started_at) DO UPDATE SET attempts = auth_rate_limits.attempts + 1, updated_at = now() RETURNING attempts`
  both records the attempt and reports the running total, with no window in which two requests can
  read the same value.
- **`INDEX (expires_at)`** serves the sweep.
- **`policy` is a column, not the table's identity**, because one endpoint carries several policies
  with different dimensions, windows, and limits (D6/D8). Folding them into an endpoint name would
  make the three sign-in dimensions share a counter, which is both surprising and exploitable.

**Deliberately absent: `household_id`, `user_id`, and every foreign key.** This table has no
relationship to tenant data and must not acquire one. A FK to `users` would turn "this address
attempted a sign-in" into a joinable fact about a real account, and would make the row's lifetime a
property of an account rather than of a window.

**What the hash is and is not. It is not secrecy, and this ADR must not be read as claiming it
is.** An unsalted, unpeppered SHA-256 of an email address or an IPv4 address is **trivially
reversible by anyone who holds the table**. Email is a low-entropy, enumerable domain: a wordlist
of addresses, or the `users.email` column itself, is hashed and matched offline in seconds. The
entire IPv4 space is 2³² digests — hours on commodity hardware, and precomputable once. Treating
`bucket` as a pseudonymised identifier for any purpose that assumes secrecy would be wrong.

What it does buy is narrower and worth stating exactly:

| Protects against | Does **not** protect against |
|---|---|
| The table becoming a *second plaintext corpus* of addresses that have attempted sign-in — a new asset with its own dump risk | Anyone who can `SELECT` the table and is willing to run a dictionary or rainbow attack. That is not a hard attack; it is an afternoon |
| Casual exposure through a query result, a screenshot, an error message, or a support session — nothing reads as an address | A targeted confirmation query: "did `ada@example.test` attempt a sign-in", answerable by hashing one string |
| Fixed-width, type-safe keys that cannot carry an injection payload or a malformed address into an index | Correlation over time: the same subject produces the same digest across windows |

**Why this is nonetheless the right shape here**, evaluated against the current repository rather
than against a general principle:

- **The confidentiality of the address is not this table's to protect, and cannot be.**
  `users`/`user_profiles` are deliberately outside RLS at HEAD (RLS migration: "Left without RLS
  deliberately"), so any `app_user` connection already reads every address in the product in
  plaintext. An attacker positioned to dump `auth_rate_limits` is positioned to dump `users`, where
  the same addresses sit unhashed beside display names. Hashing here removes an *additional* copy;
  it cannot remove the original, and pretending otherwise would be the exact overclaim this section
  exists to prevent.
- **What the table uniquely reveals is not the address but the attempt** — that someone tried to
  sign in as this subject, in this window. D11's short retention is the real control on that, not
  the digest: rows live for a window, not for 24 hours, and the table accumulates no history.
- **A pepper is resolved, not deferred** — see R2, which decides against one and names the single
  condition (P1-09's RLS decision) that would require retaking it.

**Normalization is load-bearing.** The identifier is lower-cased and trimmed before hashing;
`Ada@Example.test` and `ada@example.test ` must land in the same bucket or the limit is evaded by
pressing shift. The digest is domain-separated by policy so a `sign_in.identifier` bucket and a
`magic_link.identifier` bucket for the same address are different rows. It is taken with the same
SHA-256 primitive the repository already uses (`payloadSha256Hex` in `@autobureau/contracts/node`,
or `node:crypto` directly) — not a new scheme.

### D4 — RLS: enabled, forced, and deliberately permissive on this table alone

```
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_rate_limits_global ON auth_rate_limits FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_rate_limits TO app_user;
```

**Why household-scoped RLS is not merely unnecessary here but wrong.** These rows come into
existence precisely when no household is known. A predicate on `app.current_household()` would be
NULL at write time, the policy would deny every insert, and the limiter would fail closed on every
request — not a security property, an outage. And the rows describe *attempts*, not tenant data:
there is no household they belong to, and inventing one would put a fiction inside a tenancy
predicate, which is worse than having no predicate.

**Why enable RLS at all, then.** So that "every table has RLS, and the permissive ones say so in
their policy" stays a checkable statement. A table with RLS off is a hole whose justification lives
only in someone's memory. **This follows an existing precedent rather than inventing one:**
`vendors` is already a deliberately global table with `CREATE POLICY vendors_read … USING (true)`.
The difference is the grant — `vendors` is read-only for `app_user` and writable only by the
dispatcher, whereas `auth_rate_limits` must be writable by `app_user`, because the request path is
the only thing that writes it.

**Ordinary household data is untouched, and this is a checkable claim.** The migration creates one
table with no foreign key to any household table, adds no policy to any existing table, alters no
policy on any existing table, and changes no grant on any existing table. If a reviewer sees any of
those four in the P1-08 migration, it is out of scope for this ADR.

### D5 — IP trust: the trusted topology, the authoritative source, and what the application enforces

**Today the repository extracts no client IP anywhere.** No `x-forwarded-for`, `x-real-ip`,
`Forwarded`, `x-vercel-*`, or `request.ip` appears in `apps/web/src` or `packages`. Everything below
is therefore a decision about what P1-08 will do, not a description of what exists.

#### The trusted topology, named exactly

The application trusts **one** topology, and it is the one doc 09 §3 fixes (review A7/F-03):

> `app.autobureau.com` is DNS-only to Vercel — **no Cloudflare proxy in front of Vercel** —
> protected by Vercel's WAF + rate limiting.

That is a single-proxy topology: client → Vercel edge → route handler. Doc 12 §1 T10 still lists
"Cloudflare WAF" among the DoS controls; on `app.autobureau.com` that is **superseded by A7** and
the WAF in front of this application is Vercel's. Cloudflare proxies only `in.autobureau.com`,
`ai.autobureau.com`, and marketing, none of which reach these endpoints.

#### The authoritative source, and its position — this ADR's inference, not an inherited rule

**No governing document establishes any of this.** A search of `docs/` and `ops/` finds no mention
of `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, header ordering, or client-IP derivation anywhere in
the architecture set. Doc 09 §3 and review A7 fix the **topology** — how many proxies, and which —
and say nothing about what any of them does to a header. The rule below is therefore **this ADR's
own inference**, and is labelled as such rather than presented as something the architecture already
decided.

- **Source:** the `x-forwarded-for` request header, as set by the platform edge.
- **Position:** the **right-most** value.
- **Nothing else is read.** Not `Forwarded`, not `x-real-ip`, not any `x-vercel-*` header, not a
  caller-chosen index. One header, one position, written down so it cannot drift.

**The two premises the rule rests on, neither of which any source in this repository states:**

1. **The edge appends rather than passing through.** Under the de-facto `X-Forwarded-For`
   convention a proxy appends the peer it received the connection from to the right of the list, so
   a client-supplied prefix is left inert. If the edge instead *replaces* the header, the list holds
   one value and right-most is still correct. The rule therefore holds under both append and replace
   semantics, and fails only under pass-through — which is indistinguishable from having no proxy at
   all, handled below. **This is a convention, not a documented property of this deployment**, and
   P1-08 must not cite it as one.
2. **Exactly one appending hop sits in front of the handler.** Right-most is the client only if the
   platform edge is the *last* appender. An additional internal appending hop would make right-most
   an internal address rather than a client one. Doc 09 §3 fixes the number of *external* proxies;
   it says nothing about the platform's own internal routing, and nothing in this repository can
   count hops at runtime.

**Why right-most is still the correct choice given that uncertainty** — and this part is not
convention but reasoning about failure direction. Under append semantics, left-most is *whatever the
client sent*, so a left-most rule hands the bucket key to the attacker outright. Right-most can be
**wrong**, but it cannot be **chosen by the attacker**: the worst case is bucketing on a fixed
internal address, which degrades the IP dimension toward useless rather than forging it. Between a
rule that can be wrong and a rule that can be forged, this ADR takes the one that can be wrong.

**Verification obligation.** Both premises are settled by a single observation against a real
deployment — recording the raw header shape once, from a request whose true origin is known. That
observation belongs on doc 09 §9.9's unverified register alongside the other first-deploy unknowns;
no new infrastructure component is proposed to substitute for it. **Until it is made, the IP
dimension is implemented and enabled, but its correctness is assumed rather than known**, which is
why D6 keeps it generous and strictly secondary.

#### Assumption versus enforcement — the distinction the ADR must not blur

| Claim | Status |
|---|---|
| The deployed topology is single-proxy, as doc 09 §3 specifies | **Stated by the architecture, configured by nothing.** Doc 09 §3 and review A7 fix it; doc 09 §9.2 records that `infra/terraform/` — which would own the Cloudflare and edge configuration — **deliberately does not exist**, so no repository artifact asserts or enforces it |
| The edge appends (or replaces) `x-forwarded-for` such that the right-most value is the connecting peer | **This ADR's inference from convention. No governing document addresses it at all** — `docs/` and `ops/` contain no mention of forwarded headers. Unverified against a real edge, because doc 09 §9.9 records that **no live deployment has ever run** |
| The platform edge is the *last* appending hop, so right-most is a client address and not an internal one | **This ADR's inference.** Doc 09 §3 fixes the count of external proxies only; the platform's internal routing is outside every document here |
| Vercel's WAF and platform rate limiting are active in front of these endpoints | **Stated by doc 09 §3, unverified.** Same §9.9, and not configured by anything in this repository |
| The right-most `x-forwarded-for` value parses as an IP address | **Enforced by the application.** P1-08 parses it and treats a failure as absence |
| A missing or unparseable IP never blocks a request | **Enforced by the application** (see below) |
| The identifier limit holds regardless of the IP | **Enforced by the application** — it is a separate policy on a separate row |

Only the bottom three are things P1-08 can guarantee. Of the top four, two are stated by the
architecture but configured by nothing, and **two are this ADR's own inference with no source behind
them at all**. **P1-08 must not be described as verifying any of the four.**

#### What happens when the topology is absent or ambiguous

The application cannot detect a topology change — a proxy added in front of Vercel would produce a
well-formed header with an extra hop, indistinguishable from the expected one. It can detect the
degenerate cases, and those are handled:

| Condition | Behaviour |
|---|---|
| Header absent (local `next start`, a direct request that never crossed the edge) | IP dimension **skipped**; identifier dimension applies unchanged; `auth.rate_limit_degraded` logged once (D12) |
| Header present but the right-most value does not parse as an IP | Same as absent — skipped, logged, never an error |
| Header present and parseable | IP dimension applies |
| An extra untrusted proxy has been inserted ahead of Vercel | **Undetectable by the application.** The IP bucket silently keys on the wrong value. This is the residual risk, and it is bounded only by the IP dimension being secondary — see below |

An absent IP is never an error, never a `503`, and never a reason to reject: an endpoint that
refused to authenticate anyone because it could not determine an IP would be a worse outcome than
the abuse the IP dimension exists to blunt.

#### The IP is strictly secondary, and this is what makes the residual risk acceptable

- **No security property of this design rests on the IP dimension alone.** The blueprint's stated
  acceptance property — "limit is per-account, not global" — is satisfied entirely by the identifier
  dimension, which needs no IP and no topology assumption.
- **The IP limit is deliberately generous** (D6). It exists to blunt one-source spraying and to
  raise the cost of enumeration, not to be load-bearing, precisely because it is spoofable in any
  topology where the assumption fails and because CGNAT makes a strict per-IP limit hostile to real
  users.
- **A spoofed or wrong IP degrades the IP dimension toward uselessness; it never weakens the
  identifier dimension and never grants anything.** The failure direction is "one control stops
  contributing", not "a control is bypassed".
- **Volumetric per-IP defence remains assigned to the platform** by doc 09 §3 — with the caveat above
  that this too is currently unverified. This limiter's contribution is the per-identifier dimension
  an edge WAF cannot compute, and that is the part that does not depend on any of it.

**No new infrastructure is proposed to close this gap.** The honest closure is the first real
deployment: doc 09 §9.9 is the register where "unverified" becomes "verified", and confirming the
edge's forwarded-header behaviour belongs on that list rather than in a component invented here.

### D6 — Bucket dimensions, and what each one actually stops

Three dimensions, applied per the D8 table:

- **per normalized identifier** — all sources against one account.
- **per identifier + IP** — one source against one account.
- **per IP** — one source against many accounts.

| Attack | Which dimension bites | Honest limit |
|---|---|---|
| **Credential stuffing** (many passwords, many accounts, botnet) | per-identifier — the one dimension a distributed attacker cannot spread, and the one the blueprint's acceptance test demands ("limit is per-account, not global") | none for the single-account case; the cap holds regardless of source count |
| **Password spraying** (one common password, many accounts) | per-IP — each account sees too few attempts to trip a per-identifier limit | **a distributed spray defeats both dimensions.** This is a property of every IP/identifier limiter, not a gap in this one, and it is why doc 06 §1 also names Turnstile, which is not implemented. Not overclaimed. |
| **Magic-link abuse** (mail-bombing a third party; enumeration) | per-identifier caps mail to one address; per-IP caps enumeration from one source. **Must be checked before the provider call** — after it, the mail has already been sent | a distributed enumeration still walks the address space slowly |
| **Shared NAT/CGNAT false positives** | mitigated *by* the design: per-IP is generous and secondary, and a per-IP rejection must never stop a user whose identifier bucket is clean | a very large shared egress could still trip the generous limit; the identifier dimension is unaffected |

**A per-identifier limit is itself a denial-of-service vector against a named account,** and that has
to be said out loud: someone who knows an address can burn its sign-in allowance. The trade is
deliberate — a bounded, short, self-healing lockout of one account against a hard cap on credential
stuffing against that account. Three things bound it: the identifier-alone limit is looser than the
identifier+IP limit (so locking out a stranger costs an attacker many source addresses, not one
loop), windows are minutes rather than hours, and **a successful sign-in clears the identifier
bucket** so an ordinary user who mistypes four times and then succeeds is not left near a limit.

Two rules that are decisions rather than thresholds:

- **Every attempt counts, and a success clears the identifier bucket.** Counting only failures would
  blind the limiter to an enumeration run that gets lucky; clearing on success is what protects the
  legitimate user. Magic-link has no "success" to clear on (it always answers 204, see D10), so its
  window simply expires.
- **Each endpoint has its own policies.** `sign_in.identifier` and `magic_link.identifier` are
  separate rows with separate windows for the same address. Sharing a bucket would let a magic-link
  request consume a sign-in allowance — surprising, and usable as a targeted lockout.

**Thresholds are decided, and the reasoning behind each number is in R1.** They rest on architectural
judgment rather than repository evidence — there is no traffic to derive them from — so R1 also fixes
the revision contract, which is governed by *direction*: tightening a number is ordinary code review,
**weakening one requires amending this ADR**, and no threshold may be read from the environment or
any other runtime-mutable source.

| Policy | Dimension | Limit | Window |
|---|---|---|---|
| `sign_in.identifier_ip` | identifier + IP | 5 | 15 min |
| `sign_in.identifier` | identifier | 20 | 15 min |
| `sign_in.ip` | IP | 60 | 15 min |
| `magic_link.identifier` | identifier | 3 | 15 min |
| `magic_link.ip` | IP | 30 | 15 min |

### D7 — Failure mode: fail **open**, loudly, on every endpoint this limiter protects

**This is a risk decision, not a technicality.** An earlier draft of this ADR argued that because
`sign-in` already depends on Postgres, fail-open versus fail-closed was "not a real choice". That
argument was too strong and is withdrawn. It conflated two distinct failures, and the distinction is
the whole of this section.

#### Limiter failure is not the same as database failure

| Failure | What it is | Does authentication still work? |
|---|---|---|
| **Total database failure** | Postgres unreachable | No. `sign-in` cannot mirror an identity or ensure a household; `callback` the same. The limiter is irrelevant — the endpoint fails on its own dependency |
| **Limiter degradation** | The database is reachable and authentication works, but the limiter's own statement fails: lock-wait timeout on a hot bucket, statement timeout, pool exhaustion, a serialization failure, a bug in the limiter module, or the table missing because a migration has not been applied to a deployment that is otherwise live | **Yes** — and this is the case that matters. Authentication is fine; only the counting broke |

The second row is not hypothetical: a migration lag between the `prisma migrate deploy` step and the
running functions, or contention on a single hot bucket during exactly the attack the limiter exists
to stop, both produce a working database and a failing limiter. **Fail-closed would convert the
attack's contention into a full authentication outage** — the limiter becoming the denial of service.
That, and not the database-is-down case, is why the choice matters and which way it goes.

#### Decision

*On a limiter storage failure the request proceeds, on every endpoint this limiter protects, and
every such failure is recorded at `error` level with the policy that could not be evaluated.*

#### Why availability is prioritized over enforcement here

1. **The failure mode of fail-closed is total and self-inflicted.** Every unauthenticated user is
   locked out of the product for the duration, by a component whose only job is to count. The
   failure mode of fail-open is a bounded window in which one control is absent while every other
   control still stands.
2. **The limiter's degradation is positively correlated with the attack.** A limiter under a
   credential-stuffing load is the limiter most likely to hit lock contention. Fail-closed hands an
   attacker a cheap denial-of-service against all users by attacking the counter, which inverts the
   control's purpose.
3. **P1-08's own instruction forbids the alternative** — "do not turn 'rate-limit infrastructure is
   down' into 'all authentication is down'".
4. **This does not extend to the reject decision.** Fail-open covers only the case where the store
   *could not be consulted*. A store that answers "over limit" is always honoured.

#### What actually still protects the endpoint during degradation — verified versus assumed

This is the part an earlier draft got wrong by leaning on GoTrue. Stated precisely:

| Protection | Status in this repository |
|---|---|
| GoTrue's own rate limits | **Assumed, not verified.** `provider.ts:17-21` states plainly: "PROVIDER COMPATIBILITY IS UNVERIFIED. There is no Supabase project yet." What *is* verified is only that **if** the provider returns `429`, this application maps it to `rate-limited` and renders it (`provider.ts:88`, and the `provider.test.ts` case that pins it). That is our handling of a provider response, **not evidence that the provider imposes any limit at all.** It must not be cited as a backstop |
| Vercel WAF / platform rate limiting | **Assumed, not verified.** Doc 09 §9.9: no live deployment has ever run, no Vercel project exists; §9.2: the Terraform that would configure the edge deliberately does not exist |
| CSRF (`assertSameSiteRequest`) | **Verified in code and tests.** Bounds cross-site abuse, but not a credential-stuffing script that simply sets the header |
| Password strength / breach-corpus check | **Not implemented.** No sign-up route exists and no server-side `zxcvbn`/HIBP check exists; `lib/password.ts` is explicitly a client-side hint, not the gate |
| MFA | **Not implemented.** `profile-settings.tsx`: "no MFA mechanism exists yet — not TOTP, not WebAuthn, nothing an enrolled factor could check a code against" |
| New-device notices, hardened recovery runbook | **Not implemented** |

Doc 12 §1 T2 names five controls against account takeover — pwned-password checks, MFA, rate
limits, new-device notices, a hardened recovery runbook. **None of the other four exists**, which
means P1-08's limiter will be the *first and only* application-layer T2 control. That raises the
stakes of this decision rather than lowering them, and no honest version of this ADR can point at a
sibling control to absorb the risk.

#### Residual risk, stated without mitigation-by-assertion

**During limiter degradation, application-layer authentication rate limiting is absent, and no other
implemented application-layer control replaces it.** Concretely:

- Credential stuffing and password spraying proceed unmetered by us for the duration.
- An attacker who can *induce* limiter degradation — most plausibly by driving contention on the
  bucket their own attack creates — gains exactly the window they want.
- The only things that may still throttle them are the provider's limits and the platform's WAF,
  **both of which are unverified today and neither of which this repository configures.**

This risk is accepted for the reasons above, and it is bounded in three ways, all of which are
obligations rather than reassurances:

1. **It must be visible.** `auth.rate_limit_unavailable` at `error` is not decoration; a limiter
   silently failing open forever is the actual disaster, and the difference between that and this
   decision is entirely whether the alert exists. Wiring it into doc 10's alert channel is a
   **condition of accepting this risk**, recorded under "What remains open" below.
2. **It must be rare.** Degradation caused by contention is a design defect, not weather. The
   single-statement upsert (D3) exists partly to keep the limiter's own lock footprint minimal.
3. **It must not be the last line forever.** The correct long-term answer to "one control, failing
   open" is more controls — Turnstile (doc 06 §1) and MFA (doc 12 §1 T2), neither of which is in
   P1-08's scope. This ADR does not schedule them; it records that the limiter is not a substitute
   for them.

#### The doc 12 §7 rule is narrowed, not overturned

Doc 12 §7's "fail-closed for anonymous" **remains the governing rule for rate-limit infrastructure
that is independent of the application** — an Upstash or Redis deployment, exactly the design doc 12
§7 was written about. There, fail-closed costs availability only during that separate service's
outage and denies an attacker the option of disabling the limiter by attacking it, and this ADR
takes no position against it.

The narrowing is confined to *this* limiter: one that shares a process, a connection pool, and a
database with the endpoint it protects, and whose degradation is therefore correlated with both the
application's own load and the attack. **If P1-13 later provisions Redis and these counters move,
doc 12 §7's rule applies again by default and this exception lapses with the reason for it.**

### D8 — Endpoint coverage: two protected, three deliberately not

| Endpoint | Application limiter | Policies | Reasoning |
|---|---|---|---|
| `POST /v1/auth/sign-in` | **Yes** | `sign_in.identifier_ip`, `sign_in.identifier`, `sign_in.ip` | The credential-stuffing target: the one endpoint where a wrong answer is worth guessing repeatedly. |
| `POST /v1/auth/magic-link` | **Yes** | `magic_link.identifier`, `magic_link.ip` | Sends mail to a third party on request. Checked **before** the provider call, or the abuse has already happened. |
| `POST /v1/auth/sign-out` | **No** | — | Requires CSRF from this origin, and the worst outcome of a flood is that the caller's own cookies are cleared — which they may do anyway. Adding a database write would make sign-out fail when the database is down, contradicting its stated contract that "a user who pressed sign-out must end up signed out of this origin even if the provider is unreachable". |
| `GET /auth/refresh` | **No** | — | Outside the blueprint's stated scope (`app/v1/auth/*`), and already bounded twice: P1-07's cooldown marker suppresses repeat attempts for 15 s, and P1-06 bounds each provider call. It also carries a session, so a limit there would be a *per-principal* dimension with a different design — and refresh's failure semantics were settled in P1-07. Reopening them here is scope creep with real regression risk. |
| `GET /auth/callback` | **No** | — | A code is single-use, high-entropy, and inert without the `HttpOnly` verifier cookie scoped to that path; guessing is not the attack. Recorded explicitly so its absence is a decision, not an omission. |

Sign-out, refresh, and callback are listed rather than skipped because "we did not think about it"
and "we thought about it and decided no" look identical in a diff.

### D9 — Boundary placement: the `/v1` boundary is not touched

**Nothing in `server/http/route.ts` changes.** ADR-011 D14 makes `/v1/auth/*` a documented
exception — those routes are not wrapped in `authenticated()`, and `sign-in`, `magic-link` and
`sign-out` are bare exported `POST` functions that perform their own CSRF check. There is therefore
no ordering question about CSRF → identity → household → authorization → attribution → idempotency →
handler for these endpoints, because for them steps 2 through 5.5 do not exist. No step is added,
removed, or renumbered.

Within a public auth handler the order is:

1. **configuration** — an unconfigured deployment answers `503` first, as it already does.
2. **CSRF** (`assertSameSiteRequest`) — unchanged, and stays ahead of the limiter. It is free and
   needs no database, and putting the limiter first would let a hostile page burn a victim's
   allowance with forged cross-site posts.
3. **schema validation** — the limiter needs a normalized identifier, which does not exist until the
   body parses. A malformed body is rejected without touching the store, so garbage cannot make the
   limiter do work.
4. **rate limit** — increment and check, before any provider call and before any identity work.
5. **provider call and handler** — unchanged.
6. **on success only** — clear the identifier bucket (D6).

Two constraints stated as rules:

- **Rate limiting is not authorization.** It answers "has this bucket had too many attempts", never
  "may this principal do this". It runs before any identity exists, it produces `429` and never
  `401`/`403`, and no capability check consults it. `server/auth/policy.ts` is untouched.
- **Per-principal limits on domain endpoints are a different ADR.** This one covers the auth surface
  only.

### D10 — Response contract, and the enumeration rules that constrain it

- **`429` with problem type `rate-limited`.** Already in `PROBLEM_KINDS`; no new problem kind is
  introduced, because ADR-011 D12 makes adding one a contract change and none is needed.
- **`Retry-After`: yes**, in seconds, the remaining lifetime of the window — doc 03 §1 requires it.
  This is the one shared helper P1-08 touches: `problemResponse` gains an optional `headers`
  argument, additively, with no behaviour change for any existing caller.
- **`RateLimit-*` headers: not emitted on `/v1/auth/*`.** Doc 03 §1 lists them, and that row is
  about the authenticated domain API, where the caller owns the budget being described. On an
  unauthenticated endpoint they tell an attacker exactly how much budget remains, and — worse —
  differing values per identifier are an enumeration oracle. A deliberate, stated deviation confined
  to the surface ADR-011 D14 already treats as exceptional. Revisit when domain-API limits land.

**Enumeration safety is the subtle part**, because both endpoints have existing anti-enumeration
properties that a careless limiter would undo:

- `sign-in` answers one message for a wrong password and an unknown address alike. **A `429` that
  fired only for accounts that exist would undo that in one release.** It does not, structurally:
  the bucket is keyed on the hashed identifier and the limiter runs *before* the provider is asked
  whether the account exists, so attempts are counted for any syntactically valid address.
- `magic-link` always answers `204` whatever the provider says. A `429` there remains safe because
  it is a fact about the *request rate*, not about the address — the same address at the same rate
  gets the same answer whether or not it has an account. Written down so nobody later "fixes" it
  into an oracle.
- **`detail` is one fixed sentence, identical to the one a provider `429` already produces**
  ("Too many attempts — try again shortly."), so a provider-imposed limit and an application-imposed
  one are indistinguishable to the caller.

**Never exposed:** the bucket value or its hash, the policy identifier, the counter, the threshold,
which dimension tripped, whether the account exists, or anything derived from the IP. The response
carries the trace id and `cache-control: no-store` like every other problem response.

**No UI work.** `components/ui/error-state.tsx` already renders `429` as "Too many requests / Give
it a moment and try again", so P0-12's error-state map needs no change.

### D11 — Retention: expiry is a predicate; cleanup is opportunistic

- **`expires_at` is authoritative.** A row whose `expires_at` has passed is treated as absent by
  every read and by the increment predicate, whether or not it has been physically deleted. Same
  convention as `idempotency_keys`, and it means **correctness never depends on a cleaner running**.
- **Fixed windows, and the cost is stated.** `window_started_at` is the request time floored to the
  policy's window length, so a window maps deterministically to one row. The known cost of fixed
  windows over sliding ones is a burst at a boundary — up to 2× the limit across two adjacent
  windows. At these thresholds that is acceptable, and far cheaper than a sliding-window log, which
  needs one row per attempt and a windowed `COUNT` on every request.
- **Cleanup is opportunistic, exactly as ADR-012 chose.** An increment may sweep expired rows for
  the same policy: bounded, cheap, and it keeps a busy policy's rows bounded by live traffic.
  **No background worker is invented by this ADR.** The `(expires_at)` index exists so a scheduled
  sweep can be added cheaply once the outbox dispatcher lands (P1-13), which is where such a worker
  belongs.
- **Cardinality is bounded by distinct buckets per window, not by attempts.** At most one row per
  (policy, distinct identifier) and one per (policy, distinct IP), per window. A million guesses
  against one account produce one row. The pathological case — an enumeration run across many
  distinct addresses — is exactly the case where the per-IP policy is also firing and capping the
  rate at which distinct buckets can be created. Rows are a few dozen bytes: no bodies, no headers,
  nothing like `idempotency_keys.response_body`.
- **Retention is minutes to hours, not the 24 hours `idempotency_keys` needs**, because a window is
  over when it is over. That is a privacy benefit worth stating: the table does not accumulate a
  history of who attempted to sign in.

### D12 — Observability: three events, one policy field, no subjects

Uses P0-01's `log()` unchanged.

| Event | Level | When |
|---|---|---|
| `auth.rate_limited` | `warn` | a request was rejected with `429` by this limiter |
| `auth.rate_limit_unavailable` | `error` | the store could not be consulted; the request proceeded (D7) |
| `auth.rate_limit_degraded` | `warn` | the IP dimension was skipped because no trustworthy IP was available (D5) |

The levels are not a new convention: `route.ts` already states "rejections are `warn`, faults are
`error`", and a limiter rejection is the limiter working while a store failure is a fault.

Fields come from the existing `LogInput`: `traceId`, `route`, `method`, `status`, and `meta`
carrying:

- **`policy`** — the policy identifier. This is a *class*, not a subject: it says which dimension
  tripped without saying who, and it is the field that makes the record actionable.
- **`route` class** — `routeOf(request)` already yields a fixed pathname for these endpoints, with
  no identifiers in it. No new mechanism.

**No per-subject field is logged — not even a truncated digest.** An earlier draft proposed a
`subject_ref` pseudonym on the `householdRef` precedent. R3 rejects it: a household id is a random
UUIDv7 whose truncated digest is genuinely irreversible, whereas an email's preimage space is small
and enumerable, so a truncated digest of one is recoverable with a wordlist. The precedent does not
transfer, and the correlation question it was meant to answer is served by `policy` (which dimension
tripped) and `traceId` (within a request).

**Never logged:** the email in any form, the IP in any form, the password, any token, the cookie
header, the bucket hash — whole or truncated — the counter, the threshold, or any provider body.
`redact.ts`'s scrubbers apply to error messages as they already do.

**Alerting is an obligation, not an optional extra.** This ADR builds no alerting — that belongs to
doc 10 — but D7 accepts the fail-open risk *on the condition that it is visible*, so
`auth.rate_limit_unavailable` reaching an alert channel is a sign-off condition for P1-08 rather
than a nice-to-have. Separately, the rate of `auth.rate_limited` by policy is the signal that an
attack is in progress; that one is genuinely a later refinement.

### D13 — Deployment: no new runtime infrastructure, and here is why

- **Nothing is provisioned.** No new service, no new client dependency in any `package.json`, no new
  environment variable, no new Doppler secret, no change to `vercel.json`, and no change to
  `.github/workflows/deploy.yml`. The limiter reads and writes through `DATABASE_URL`, which
  `.env.example` already lists as required in every deployed environment and which
  `apps/web/src/server/db.ts` already opens once per runtime instance.
- **The migration path is the existing one.** `deploy.yml` runs `prisma migrate deploy` on the
  direct (non-pooled) connection before the code that depends on it, in both staging and production.
  A new table is expand-only and needs nothing else. The P1-08 migration will state lock impact,
  table size at 100k households, and rollback, per CLAUDE.md's working agreements.
- **Pooling is unaffected.** The limiter's unit of work is one or two statements in a short
  transaction on the pooled `app_user` connection — the same shape `withHousehold` already uses, and
  compatible with transaction-mode pooling for the same reason.
- **Local development needs nothing new.** `pnpm db:up` already starts Postgres. (Worth noting
  without acting on it: `db:up` also starts a Redis that nothing uses. This ADR neither changes that
  nor makes it used.)
- **Integration tests need nothing new.** The integration tier already runs against real Postgres
  with `DATABASE_ADMIN_URL` seeding and `DATABASE_URL` asserting under RLS, and files run serially
  because they share one database. The concurrency property — two simultaneous increments produce
  two distinct counts — is provable there today.
- **CI gains one guardrail step** (D2) and no service.
- **Preview deployments** inherit the same configuration; nothing about the limiter is
  per-deployment.

## Consequences

- ✅ **Zero new infrastructure.** P1-08 ships on what is already deployed, as P1-05 did.
- ✅ **The anonymous capability is bounded by a type, not by a convention**, and the database refuses
  household data through it regardless (D2).
- ✅ **The existing anti-enumeration properties of both endpoints survive**, and D10 says why in
  terms a future change has to argue with.
- ✅ **The `/v1` boundary and `middleware.ts` are untouched.** So are `provider.ts`, `session.ts`,
  and the P1-07 refresh route.
- ⚠️ **Failed attempts become writes on the primary.** Bounded by distinct buckets rather than by
  attempts (D11), but it is the first time an unauthenticated request writes to this database. If
  the write path ever becomes hot, this is the second thing to measure after idempotency.
- ⚠️ **`scoped.ts` gains a fourth kind of scope.** That file is the tenancy chokepoint and every
  addition to it costs something. The mitigation is that this one sets no GUC at all, so it cannot
  reach tenant data even by mistake — but the file is longer and one more thing has to be understood
  before changing it.
- ⚠️ **A per-identifier limit is a bounded denial-of-service vector against a named account** (D6).
  Accepted deliberately, with three named bounds.
- ⚠️ **A distributed spray defeats both dimensions.** Rate limiting alone does not discharge doc 06
  §1's abuse controls; Turnstile is the missing half and is not in P1-08.
- ⚠️ **The IP dimension rests on assumptions this repository neither configures nor verifies** (D5).
  Named as assumptions, with the design arranged so nothing important depends on them.
- ⚠️ **Fail-open means the limiter can be absent exactly when it is needed** (D7). This is the
  ADR's most significant accepted risk: during limiter degradation there is **no other implemented
  application-layer control** against credential stuffing — MFA, breach-corpus checks, new-device
  notices and Turnstile are all absent — and the provider and platform protections that might
  compensate are unverified. Accepting it is conditional on the `error`-level signal reaching an
  alert channel.
- ⚠️ **This limiter will be the only implemented control of doc 12 §1 T2** (account takeover). Doc
  12 names five; the other four do not exist. The document reads as though a layered defence is in
  place, and for the foreseeable term it is not.
- ⚠️ **The bucket hash is not secrecy** (D3). It prevents a second plaintext corpus and casual
  exposure; it does not withstand a wordlist. Anyone reading `CHAR(64)` and inferring anonymisation
  will be wrong.
- ⚠️ **Doc 12 §7 is now narrowed twice over** — store, and anonymous failure mode — both explicitly
  and both with reasoning, and the failure-mode narrowing lapses if these counters ever move to
  independent infrastructure. Anyone reading doc 12 §7 alone will get the wrong answer for this
  limiter.
- ↩️ **Reversible.** Nothing references the table and no domain row points at it. Dropping it
  returns these endpoints to today's posture: no application-layer limit at all, and reliance on
  provider behaviour that has never been observed.

## Resolved decisions

An earlier draft left three of these "open" while presenting the ADR as ready to review. That was
the wrong posture: each materially changes implementation semantics, so each is decided here.
Every one separates **repository evidence**, **architectural judgment**, and **remaining risk**.

### R1 — Thresholds and windows are decided, as code constants, with an explicit revision contract

**Decided.** The D6 table is the shipping configuration for P1-08. It is no longer labelled
provisional.

- **Repository evidence:** none, and none is obtainable. There is no deployment (doc 09 §9.9), no
  telemetry, no sign-in traffic, and no PRD figure for tolerable lockout. No amount of reading this
  repository produces a defensible number.
- **Architectural judgment**, which is what the numbers actually rest on:
  - `sign_in.identifier_ip` = 5 / 15 min — above ordinary human error (a person who has forgotten a
    password tries three or four times, then uses recovery) and far below a useful guessing budget.
  - `sign_in.identifier` = 20 / 15 min — four times the single-source limit, so a distributed
    attacker needs at least four source addresses to reach it, while a legitimate user on a mobile
    connection that changes address mid-session is not caught by the stricter bucket. It also prices
    the lock-out-a-neighbour attack (D6): denying one account for ≤15 minutes costs 20 attempts
    across ≥4 addresses.
  - `sign_in.ip` = 60 / 15 min — a shared office or CGNAT egress with twenty people signing in over
    a morning stays far below; a spray across sixty accounts from one host does not.
  - `magic_link.identifier` = 3 / 15 min — caps mail to one address at twelve messages an hour,
    while leaving room for the "it didn't arrive, resend" case twice.
  - `magic_link.ip` = 30 / 15 min.
- **The implementation contract that is acceptance-ready now**, and which does not depend on the
  numbers being right:
  1. The five policy names, their dimensions, and fixed-window semantics are fixed by this ADR.
  2. Every attempt is counted; a successful sign-in clears the identifier buckets (D6).
  3. Thresholds and windows are **constants in one table in one module**. Reading a threshold or a
     window from `process.env`, from a database row, or from any other runtime-mutable source is
     **not permitted by any route short of amending this ADR** — an operator must not be able to
     widen a security control without a code review, and a deployment must not be able to differ
     from what this ADR says it enforces. Literals in one module make that greppable. It is also
     what keeps D13's "no new environment variable" true.
  4. **Revision is governed by direction, not by size.** A policy's security posture is its
     permitted attempt rate — `limit ÷ window` — together with the set of policies in force.
     - **Tightening or neutral** — any change that increases no policy's permitted rate and removes
       no policy — is implementation tuning: ordinary code review, no ADR amendment. It is cheap
       precisely because it cannot weaken the control.
     - **Weakening** — raising any limit, increasing any policy's permitted rate, removing or
       disabling a policy, changing a dimension, or altering the count-every-attempt or
       reset-on-success rules — **is an architecture change and requires amending this ADR.** That
       is not a new process: the architecture set is frozen and amendments require evidence plus an
       ADR (`docs/architecture/README.md`), and FOUNDING_PRINCIPLES §10's corollary is that evidence
       "does not silently edit a frozen document — it opens the amendment door". This clause only
       names these thresholds as one of the things that existing rule already covers, so that
       "it's just a constant" is never mistaken for "it's outside governance".
     - **Reducing a limit to zero, or to a value no legitimate user can satisfy, is also a
       weakening** — of availability rather than of enforcement — and takes the same route. The
       symmetric loophole is worth closing explicitly: "tighten it to nothing" would turn the
       limiter into the outage D7 exists to prevent.
     - **What is genuinely out of scope for an amendment:** correcting a number downward on real
       traffic, which is the case this contract exists to keep frictionless.
- **Remaining risk:** the numbers may be wrong in either direction on first contact with real
  traffic — too tight produces support load from locked-out users, too loose produces a limit that
  never binds. Both are correctable in one edit, and neither is a security regression relative to
  today, where the limit is zero. First real traffic is the evidence this decision is waiting on,
  and R1(4) is how a correction downward gets incorporated without ceremony — while a correction
  upward goes through the amendment door.

### R2 — No pepper on the bucket hash

**Decided: no pepper.**

- **Repository evidence:** `users`/`user_profiles` carry no RLS at HEAD — the RLS migration says so
  in terms ("Left without RLS deliberately"), and no later migration adds one. Any `app_user`
  connection therefore reads every address in the product in plaintext.
- **Architectural judgment:** a pepper would defend the `auth_rate_limits` digests against an
  attacker who can already `SELECT users.email` unhashed. It defends nobody who is not already past
  that wall, and it would cost a secret in Doppler plus a per-environment variable, plus a rotation
  story that invalidates every live bucket at rotation time. Against the current RLS posture that is
  cost with no corresponding gain.
- **Remaining risk:** the judgment is entirely contingent on that posture. **P1-09 exists to decide
  whether `users` gets a self-read policy.** If it does, `users.email` stops being freely readable,
  the digests here become the *weakest* copy of the identifier corpus, and this decision must be
  retaken. That contingency is written into P1-09's scope by this sentence rather than left to
  memory.

### R3 — `subject_ref` is **not** logged

**Decided: the limiter logs no per-subject field at all.** D12 is corrected accordingly.

- **Repository evidence:** `householdRef` (`observability/logger.ts`) is the precedent an earlier
  draft cited — a truncated SHA-256 that "keeps records joinable to each other and to nothing else".
- **Architectural judgment — the precedent does not transfer, and the reason is precise.** A
  household id is a random UUIDv7: roughly 122 bits of preimage entropy, so a truncated digest of it
  is genuinely irreversible. An email address has almost no preimage entropy — the domain is small,
  enumerable, and available in `users.email` — so a truncated digest of one is **reversible by
  anyone with a wordlist**, exactly as D3 now says. Logging it would place a recoverable subject
  identifier in a log aggregator, whose readership is broader than the database's, in service of a
  correlation question that is already answered otherwise: `policy` says which dimension tripped,
  and a per-identifier policy firing at all means one subject reached its limit. `traceId` correlates
  within a request.
- **Remaining risk:** an operator investigating an attack cannot tell from logs alone whether forty
  rejections are one subject or forty. That is a real, accepted loss of investigative resolution.
  The compensating path is the table itself, which is queryable during the incident by someone with
  database access — a narrower and more auditable audience than log search, which is the right place
  for that capability to live.

## What remains open, and whether it blocks acceptance

Nothing below is a decision this ADR needed to make. Each is an obligation on other work, recorded
so it is not mistaken for something already handled.

| Item | Blocks ADR acceptance? | Blocks P1-08 sign-off? |
|---|---|---|
| **Alerting on `auth.rate_limit_unavailable`** must reach doc 10's alert channel. D7 accepts a fail-open risk *on the condition that it is visible*; an unalerted fail-open is the failure this ADR would otherwise be creating | No — it is a wiring obligation, not an undecided architecture | **Yes.** This is the condition attached to D7 |
| **Verifying the edge's forwarded-header behaviour and the Vercel WAF** against a real deployment (D5) — one observation of the raw header shape from a request of known origin. Belongs on doc 09 §9.9's unverified register | No — D5 states the right-most rule as this ADR's own inference with both premises named, rather than claiming a source establishes it | No — the identifier dimension needs no IP, and a wrong IP degrades a generous secondary control rather than forging one. It does gate any future decision to make the IP dimension load-bearing |
| **Turnstile (doc 06 §1) and MFA (doc 12 §1 T2)** remain unimplemented; the limiter is not a substitute for either, and D7 records that it will be the only T2 control in force | No | No — out of P1-08's scope by the blueprint |
| **Retaking R2 if P1-09 puts `users` under RLS** | No | No — a future contingency, not a present gap |

**The ADR is decision-complete.** Every question that changes what P1-08 builds is answered above;
what remains are obligations on implementation and on a deployment that does not yet exist. Status
stays **Proposed** regardless: it becomes Accepted when the implementation is reviewed, not when the
decisions stop moving.

## What this ADR does not decide

- **It writes no migration, no table, and no limiter.** The schema in D3 is conceptual; P1-08 owns
  the DDL, the indexes, the sweep predicate, and the lock/size/rollback statement CLAUDE.md requires.
- **It does not change ADR-005.** The outbox still targets Redis Streams. If Redis is provisioned
  for P1-13, D1 becomes worth revisiting on measured contention — not on tidiness.
- **It does not extend rate limiting to `/v1` domain endpoints.** Per-user and per-household buckets
  (doc 12 §7, doc 03 §1) remain undecided, and `RateLimit-*` headers on that surface remain open.
- **It does not build alerting** on the events in D12, or a scheduled sweep in D11.
- **It does not touch `middleware.ts`, `provider.ts`, `session.ts`, the P1-07 refresh route, the
  `/v1` boundary, `apiFetch`, ADR-011, or ADR-012.**
