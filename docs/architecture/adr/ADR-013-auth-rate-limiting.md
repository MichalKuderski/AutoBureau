# ADR-013 — Authentication rate limits live in Postgres, reached by one narrow anonymous path

**Status:** Proposed · blueprint P1-08. **Not to be marked Accepted until the implementation is reviewed.**
**Date:** 2026-08-25
**Supersedes, narrowly:** the store named in `12-security.md` §7 ("Upstash sliding-window") and the
anonymous fail-closed rule in `12-security.md` §7 / `01-system-architecture.md` §8 ("Redis down") —
**for this limiter only**. ADR-005 is untouched: the outbox still targets Redis Streams, which is a
fan-out decision, not a counting one.
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

**Normalization is load-bearing.** The identifier is lower-cased and trimmed before hashing;
`Ada@Example.test` and `ada@example.test ` must land in the same bucket or the limit is evaded by
pressing shift. The digest is taken with the same SHA-256 primitive the repository already uses
(`payloadSha256Hex` in `@autobureau/contracts/node`, or `node:crypto` directly) — not a new scheme.

**Why hash the subject, given D4?** Not to defeat a database reader: `users`/`user_profiles` are
deliberately outside RLS (RLS migration, §"users / user_profiles are not household-scoped"), so
`app_user` can already read every address in plaintext. Hashing is for the two things it does buy —
the table never becomes a *second* copy of the identifier corpus, and nothing reversible to an email
or an IP is available to be logged, dumped, or joined. Whether to add a pepper is Open decision 2.

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

### D5 — IP trust: one hop, one header, one stated assumption, and a named residual risk

**Today the repository extracts no client IP anywhere.** No `x-forwarded-for`, `x-real-ip`,
`Forwarded`, `x-vercel-*`, or `request.ip` appears in `apps/web/src` or `packages`.

**The assumption, stated rather than assumed.** Doc 09 §"Edge split" (review A7/F-03) puts
`app.autobureau.com` **DNS-only to Vercel — no Cloudflare proxy in front of Vercel** — protected by
Vercel's own WAF and rate limiting. A request reaching a route handler has therefore traversed
exactly one trusted hop. On that topology, the value the platform edge places in `x-forwarded-for`
is the connecting peer as the platform saw it, and client-supplied values are overwritten there.

**Where it is enforced: nowhere in this repository. That is the residual risk and it is named here
rather than papered over.** The assumption rests on a deployment topology (`vercel.json`, doc 09 A7)
and a platform behaviour, neither of which the application can assert at runtime. Two ways it
breaks: a proxy placed in front of Vercel later (contradicting A7) silently makes the IP bucket
wrong; and a request that reaches the app without traversing the edge — a direct hit on a deployment
URL, or `next start` locally — has no trustworthy IP at all.

Five consequences follow, and together they are why that risk is acceptable:

1. **The identifier bucket is primary; the IP bucket is secondary.** No security property depends on
   the IP dimension alone. If the IP is absent or untrustworthy, the identifier limit still holds
   and the endpoint is still protected against the attack that matters most.
2. **An absent or unparseable IP is not an error and never blocks a request.** The IP dimension is
   skipped, and the skip is logged once (D12) rather than passing silently.
3. **We read one header at one position and nothing else.** No `Forwarded`, no `X-Real-IP`, no
   caller-chosen index into `X-Forwarded-For`. The rule is written down so it cannot drift into
   "trust whatever is furthest left".
4. **The IP limit is generous** — it exists to blunt spraying from one source, not to be
   load-bearing, because it is spoofable in any topology where the assumption fails.
5. **Volumetric per-IP defence stays the platform's job**, exactly as doc 09 already assigns it.
   This limiter's contribution is the per-identifier dimension an edge WAF cannot compute.

### D6 — Bucket dimensions, and what each one actually stops

Three dimensions, applied per the D8 table:

- **per normalized identifier** — all sources against one account.
- **per identifier + IP** — one source against one account.
- **per IP** — one source against many accounts.

| Attack | Which dimension bites | Honest limit |
|---|---|---|
| **Credential stuffing** (many passwords, many accounts, botnet) | per-identifier — the one dimension a distributed attacker cannot spread, and the one the blueprint's acceptance test demands ("limit is per-account, not global") | none for the single-account case; the cap holds regardless of source count |
| **Password spraying** (one common password, many accounts) | per-IP — each account sees too few attempts to trip a per-identifier limit | **a distributed spray defeats both dimensions.** This is a property of every IP/identifier limiter, not a gap in this one, and it is why doc 06 §1 also names Turnstile (Open decision 3). Not overclaimed. |
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

**Thresholds are Open decision 1.** The values below are provisional, are not ratified by this ADR,
and exist so P1-08's shape is unblocked while the numbers are settled.

| Policy | Dimension | Provisional limit | Provisional window |
|---|---|---|---|
| `sign_in.identifier_ip` | identifier + IP | 5 | 15 min |
| `sign_in.identifier` | identifier | 20 | 15 min |
| `sign_in.ip` | IP | 60 | 15 min |
| `magic_link.identifier` | identifier | 3 | 15 min |
| `magic_link.ip` | IP | 30 | 15 min |

### D7 — Failure mode: fail **open**, loudly, on every endpoint this limiter protects

The conflict is real and both sides were written in good faith. Doc 12 §7 and
`01-system-architecture.md` §8 say the limiter fails **closed for anonymous**. P1-08 requires that a
limiter-backend failure must not make authentication unavailable.

**They were written about different worlds.** Doc 12 §7 assumed a limiter in Upstash — an
*independent* service whose failure is uncorrelated with the application's. Fail-closed there costs
availability only during a Redis outage and buys certainty that an attacker cannot disable the
limiter by attacking Redis. D1 moves the counters into the application's own database, which
changes the calculus completely:

- For **`sign-in`**, the database is *already* a hard dependency: `sign-in/route.ts` mirrors the
  identity and ensures a household before it issues cookies. If Postgres is unreachable, sign-in
  cannot succeed whatever the limiter does. Fail-open versus fail-closed is not a real choice
  there — only a choice of which error to report, and reporting `429` would be a lie while
  reporting the limiter's own `503` would replace a specific error with a vaguer one.
- For **`magic-link`**, the database is not otherwise required, so this is a genuine choice with a
  genuine cost.

**Decision, as one rule:** *on a limiter storage failure the request proceeds, on every endpoint,
and every such failure is recorded at `error` level with the policy that could not be evaluated.*

**The trade-off, not hidden:**

- **Cost.** For the duration of a database outage the application-level auth limits are not
  enforced. An attacker who could reliably take Postgres down could suppress them. What they gain is
  narrower than it sounds: they have already taken sign-in down (it cannot mirror an identity), so
  what is left is unmetered attempts against a provider that still answers — and GoTrue's own limits
  remain in force, which is the `rate-limited` path `provider.ts:88` already handles. The exposure
  is an outage window, not a standing condition.
- **Benefit.** No failure of the limiter can, by itself, lock every user out of the product. Turning
  "the counters are unreachable" into "nobody may sign in" would make the limiter a *cause* of the
  outage it exists to survive — which is precisely what P1-08 forbids.
- **Why this is a scoped amendment and not a quiet contradiction.** Doc 12 §7's anonymous
  fail-closed rule is about a limiter whose failure is independent of the application's. This
  limiter has no independent failure mode on the endpoint that matters most. The rule therefore does
  not apply to the Postgres-backed auth limiter defined here, and **remains in force for any future
  limiter that runs on independent infrastructure**.

Two boundaries on this rule: a limiter *decision* to reject is never affected — fail-open covers
only the case where the store could not be consulted, never a store that answered "over limit". And
a fail-open is never silent (D12), while also never being so noisy it becomes the outage: one record
per occurrence.

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

### D12 — Observability: two events, one policy field, no subjects

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
- **`subject_ref`** — the first 12 hex characters of the stored bucket hash, as a pseudonym, so an
  operator can see that forty rejections are one subject without recovering the subject. This
  follows the `householdRef` precedent exactly ("truncated SHA-256 keeps records joinable to each
  other and to nothing else"). It is a truncation of an already-irreversible digest, not the limiter
  key. **This is the one field a reviewer should argue about** — it is listed as Open decision 4
  rather than slipped in.

**Never logged:** the email in any form, the IP in any form, the password, any token, the cookie
header, the full bucket hash, the threshold, or any provider body. `redact.ts`'s scrubbers apply to
error messages as they already do.

Alerting on the rate of `auth.rate_limited` by policy is the signal that an attack is in progress.
That belongs in doc 10's alerting, and **this ADR does not build it**.

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
  §1's abuse controls; Turnstile is the missing half and is not in P1-08 (Open decision 3).
- ⚠️ **The IP dimension rests on an assumption this repository cannot enforce** (D5). Named, with
  the design arranged so nothing important depends on it.
- ⚠️ **Doc 12 §7 is now amended twice over** — store, and anonymous failure mode — both narrowly and
  both with reasoning. Anyone reading doc 12 §7 alone will get the wrong answer for this limiter.
- ↩️ **Reversible.** Nothing references the table and no domain row points at it. Dropping it means
  auth endpoints revert to today's behaviour: provider-enforced limits only.

## Open decisions

These are unresolved on purpose. 1 must be settled before P1-08 merges; the others may outlive it.

1. **Thresholds and window lengths.** The D6 table is provisional. Ratifying it is a product and
   security judgement — how many failed passwords before a real person is locked out is a
   support-cost decision as much as a security one — and there is no evidence in the repository or
   the PRD to derive it from. The *shape* of P1-08 does not depend on the numbers.
2. **Whether to pepper the bucket hash.** Recommended **no**: `users.email` is already readable in
   plaintext by `app_user` (`users`/`user_profiles` are deliberately outside RLS), so a pepper
   defends against nobody who is not already past that wall, and it would cost a new secret — the
   exact acquisition this ADR avoids elsewhere. **Revisit if P1-09 puts `users` under RLS**, because
   that changes the calculus.
3. **Cloudflare Turnstile** (doc 06 §1) is not implemented and is not in P1-08. It is the half of
   doc 06 §1's abuse controls that answers the distributed spray this limiter cannot. Tracked, not
   scheduled here.
4. **Whether `subject_ref` is logged at all** (D12). It follows the `householdRef` precedent and is
   irreversible, but it is the one observability field that touches the subject and it should be an
   explicit choice.

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
