# AutoBureau Hardening Audit — Phase 0: Ground Truth

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh` (based on `origin/main` @ `56cf76e`)
**Status:** Observation only. No application code was changed.

This document establishes verified ground truth before the UX, functionality, architecture,
security, entitlement, and Plaid audits. Every claim below is backed by a command that was
actually run in this session, not by reading a document that asserts it.

---

## 1. Verification results (all executed, this session)

The environment needed three fixes before anything could be verified. None were repo defects:

| Obstacle | Cause | Resolution |
|---|---|---|
| `prisma generate` failed | Proxy TLS re-termination; Prisma didn't read the CA bundle | `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` |
| No database | Docker unavailable in this container | Local PostgreSQL 16 started; `pgvector` installed via apt |
| `app_user` could not connect | The RLS migration creates it `NOLOGIN` by design | `ALTER ROLE app_user LOGIN` (test harness only) |

With those resolved, the full gate was run:

| Gate | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | ✅ clean (exit 0) |
| Typecheck | `pnpm typecheck` | ✅ 6/6 packages |
| Build | `pnpm build` | ✅ succeeds, 22 routes emitted |
| Unit tests | `pnpm test` | ✅ **313 passed** (web 259, contracts 38, db 16) |
| Integration | `pnpm test:integration` | ✅ **146 passed** (web 98, db 48) |

**Total: 459 tests, zero failures, zero skips.**

The integration suite ran against a database where `app_user` is **not** superuser, **not**
table owner, and has `rolbypassrls = false` — verified via `pg_roles`. Tables are owned by
`autobureau`. RLS therefore genuinely applies; this is not the false-green the repo's own
`.env.example` warns about.

### 1.1 Tenant isolation — independently reproduced

The test suite's own claim was not taken at face value. Two users and two households were
seeded on the admin connection, then queried on the RLS-bound `app_user` connection:

| Connection state | `households` visible | Interpretation |
|---|---|---|
| No `request.household_id` GUC | **0** | Fails **closed** ✅ |
| Scoped to House A | **1** (House A only) | Correct isolation ✅ |

> Note for reproducibility: the GUC is `request.household_id`, **not** `app.household_id`.
> `app.current_household()` is the *reader* function. An initial probe using the wrong name
> produced a misleading "0 rows" that looked like isolation but was only a NULL predicate.

**The core tenancy invariant is real, enforced by the database, and verified.** This is the
strongest part of the system and must be preserved unchanged through hardening.

---

## 2. The central finding: what is real vs. what is demo

The repository is best described as **a production-grade authentication and tenancy
foundation underneath an almost entirely fixture-backed product UI.**

### 2.1 Real, server-backed, tested

- Deny-by-default route middleware (catch-all matcher; unconfigured deployment denies rather
  than fails open).
- Asymmetric-only JWT verification (symmetric algorithms refused by construction).
- PKCE magic-link issue/redemption; server-side session transport; cookies only.
- CSRF enforcement; exact-match public-route allowlist; open-redirect guard.
- Identity mirroring with audit rows.
- Postgres RLS across 14 household-scoped tables, `FORCE`d.
- `(app)/layout.tsx` — one short scoped transaction reading household, members, entitlement
  plan, and viewer profile. **This is the only server-side domain read in the product.**
- `GET /v1/households/current` — the only domain endpoint.

### 2.2 Demo only — no persistence exists

`apps/web/src/lib/domain/queries.ts` is the data layer for every screen. Its own header says
so plainly. Exactly **one** of its twelve hooks (`useCurrentHousehold`) reaches `/v1`. Every
other read resolves from `lib/domain/fixtures.ts` behind a 220 ms artificial delay, and every
**mutation is a `setTimeout` that returns its own argument**:

```ts
mutationFn: async ({ id, status, outcome }) => {
  await new Promise((r) => setTimeout(r, 260));
  return { id, status, outcome: outcome ?? null };   // never persisted
}
```

Consequence: marking an obligation complete, capturing an outcome, or reading a notification
updates the React Query cache and is **lost on reload**. The optimistic-update and rollback
machinery is well built, but there is no server for it to reconcile against.

**The API surface is 6 route handlers, total:**

```
/auth/callback   /auth/refresh
/v1/auth/sign-in   /v1/auth/sign-out   /v1/auth/magic-link
/v1/households/current
```

There is **no** endpoint for obligations, items, documents, timeline, notifications, upload,
or settings. The 17-table schema is fully migrated and almost entirely unaddressed by code.

---

## 3. Subsystem ground truth (maps to the upcoming audit phases)

### 3.1 UX / UI — 22 routes

14 authenticated screens, 3 auth screens, 4 onboarding steps, 1 landing page. A real design
system exists (17 UI primitives, 5 patterns), with focus-trap, ARIA meter, toast, and modal
work that looks deliberate rather than generated.

Two dangling capabilities found — hooks with **zero consumers**:

| Hook | Consumers | Implication |
|---|---|---|
| `useItem` | 0 | No item-detail route exists (`/items/[id]` absent entirely) |
| `useMarkNotificationsRead` | 0 | Notifications can be displayed but never marked read |

`obligations/[id]` is the only detail route in the product.

### 3.2 Security / auth

Genuinely strong, and the reasoning is documented in-line rather than asserted. One item to
carry into the security phase — **documented, deliberate, but load-bearing**:

`users` and `user_profiles` carry **no RLS at all** (`relrowsecurity = false`). Verified
empirically: `app_user` reads **all** rows in both tables regardless of household scope.

This is intentional — the RLS migration states these are not household-scoped and that access
is enforced in the session layer, and `(app)/layout.tsx` does scope its read with an explicit
`where: { id: ctx.userId }`. The decision is defensible. But it means **the sole protection
for the global identity table (including every user's email) is application code.** Any future
query against `users` that omits its `where` clause leaks across all tenants with no database
backstop. This deserves a decision in the hardening phase: accept and add a guardrail test, or
add a `request.user_id`-keyed policy.

`vendors` is `ENABLE`d but not `FORCE`d RLS — consistent with its documented "global shared
rulebook, readable by all" design.

### 3.3 Subscriptions / entitlements

- An `entitlements` table **exists**, is RLS-protected, and carries real quota columns:
  `plan`, `docs_per_month`, `members_max`, `period_start`, `docs_used_this_period`.
- It is read in exactly one place — `(app)/layout.tsx:101` — to derive `plan: "free" | "premium"`.
- **No quota is enforced anywhere.** `docs_used_this_period` is never read or incremented.
- `settings/billing` is **fully presentational**: plan state is local `useState`, usage is a
  hardcoded `docsUsed = 7`, and "Upgrade" flips a boolean and fires a toast. No server call.
- **No payment processor exists.** Stripe appears nowhere in the codebase.

So the entitlement *schema* is designed; the entitlement *system* is not built.

### 3.4 Plaid

**Entirely absent from the codebase** — zero matches across `apps/`, `packages/`, `ops/`.
This is consistent with governance: `CLAUDE.md` lists Plaid among the postponements that are
"**not** to be reintroduced without a PRD amendment," and `FOUNDING_PRINCIPLES` states "no
credentials, no money movement — in v1" as a security posture rather than a missing feature.

**A Plaid integration audit therefore has no code to audit.** Any Plaid work is a net-new
feature that contradicts a stated founding principle. Flagged for your decision, not assumed.

---

## 4. Two semantic traps that will corrupt a careless audit

Both words are overloaded in this codebase. Grep-driven review will produce false positives:

1. **"subscription"** — in `packages/contracts` this is an **item kind**: a thing the household
   subscribes to (Netflix, a gym). It has nothing to do with AutoBureau billing.
2. **"entitlement"** — the DB model means *plan/quota*, but throughout the obligations UI
   (`obligation-card.tsx`, `obligation-detail-screen.tsx`) "entitlement" means **money owed
   *to* the household** — a refund or deposit. Different concept, same word.

Additionally, `STRIPE` in `obligation-card.tsx` is a CSS severity stripe, not the payments SDK.

---

## 5. Governance vs. reality discrepancies

| Document says | Reality | Severity |
|---|---|---|
| `CLAUDE.md`: "`apps/` (not yet created — walking skeleton lands here post-G1)" | `apps/web` exists with ~16,200 LOC | **Stale doc** — `README.md` is correct; `CLAUDE.md` was not updated |
| `README.md`: "product feature work is deliberately paused" pre-G1 | 14 product screens are built | Reality has outrun the stated phase gate |
| G1 gate dated ~2026-08-25 | Today is 2026-08-18 | Gate is 7 days out and undecided |

`CLAUDE.md` §"Repository map" is the specific line that is wrong. Worth correcting early, since
it is the file that instructs every future engineer and agent.

---

## 6. Branch state (resolved)

`origin/main` and the prior branch head had **byte-identical trees** (`9a9d1b6`) — main carried
a squash-merge of the same two commits. The audit branch was reset onto `origin/main`; a
`git diff` against the previous head confirmed **no content was lost**. No divergence risk
remains, and there are no competing auth implementations.

---

## 7. Open questions for the next phase

1. **Plaid** — it does not exist and is constitutionally postponed. Is the intent to audit a
   *proposed* integration, or to revisit the postponement? This needs a PRD §21 amendment
   either way.
2. **G1 gate** — is the hardening phase superseding the gate, or running before it? This
   changes whether wedge-dependent work is in scope.
3. **`users` RLS** — accept the application-layer enforcement with a guardrail test, or add a
   database policy?
4. **Fixture-to-API cutover** — this is the single largest body of work implied by
   "hardening," and it is feature-building, not hardening. It should be sized explicitly
   rather than absorbed.

---

## 8. What was not done

No application code, schema, test, or governance document was modified. The only changes in
this commit are this document and its directory. Environment changes (postgres, pgvector,
Prisma CA) are container-local and touch no tracked file.
