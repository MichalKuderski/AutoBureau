# AutoBureau — engineering guardrails

Read before writing code. The governing documents outrank any instinct about what
"should" be built.

## Governing documents (precedence order)

0. `FOUNDING_PRINCIPLES.md` — **the constitution.** Mission, invariants, decision hierarchy, and the
   things we will never do. Read it first; it outranks everything below and every instinct.
1. `docs/product/PRD-v1.md` — **product scope.** Anything not in it is out of scope for v1.
2. `docs/architecture/` (v0.2.0-review + `review/2026-07-23-principal-panel-review.md`) — **engineering constraints.** ADRs 001–008 in `adr/`.
3. `docs/strategy/` — why the company is shaped this way (red-team, ledger thesis, blueprint, competitive).
4. `ops/assumptions.yaml` — the machine-readable hypothesis registry (source of truth; schema-validated
   in CI). `ops/assumption-ledger.md` holds the updating rules and evidence index.

**"Why does this exist?"** → `docs/TRACEABILITY.md` maps every component to the decision, spec, test,
and guardrail behind it — including the things deliberately absent.

Disagreement between (1) and (2) on scope → PRD wins. On engineering constraint → architecture wins.
**Neither is edited casually**: PRD changes go through its §21 process; architecture changes need an ADR.

## Current phase

**Build Mode, pre-G1.** The four-week validation sprint (`ops/p0/`) is the critical path;
G1 (~2026-08-25) decides kill / re-roll / proceed and confirms the wedge.

Zero-regret foundation work (tenancy, contracts, CI, outbox — identical whatever G1 says)
proceeds now. **Wedge-dependent feature work waits for G1**: doc-type-specific extraction,
onboarding copy, persona-shaped UI.

## Invariants

**The authoritative list is `FOUNDING_PRINCIPLES.md` §7 (ten invariants).** Do not maintain a second
copy here — two lists drift, and the day they disagree nobody knows which one is binding.

What follows is *how the invariants show up in this codebase* — the operational notes, not the law.

- **All household data access goes through `Database.withHousehold`** (`packages/db`).
  Never construct a bare `PrismaClient` in application code. The scoped path wraps every
  unit of work in a transaction whose first statement sets the tenant GUC — outside a
  transaction, RLS silently denies everything; at session level it leaks across pooled
  connections. See `packages/db/src/scoped.ts` (review blocker F-01).
- **Scoped transactions stay short.** No network I/O (model calls, storage, webhooks)
  inside `withHousehold` — it pins a pooled connection. Read, close, then do the slow thing.
- **Side effects go through the outbox**, in the same transaction as the domain write
  (`outbox(tx).emit(...)`). Never publish to a queue from a request handler (ADR-005).
- **Identifier-grade PII lives only in `item_secrets`** — never in `attrs`, logs, prompts,
  analytics, or search. The AI runtime holds no decrypt grant (ADR-007).
- **Application code never imports a model-provider SDK.** All model access is via the AI
  service's gateway (ADR-006). CI enforces this.
- **Money is integer cents.** The canonicalization profile (`packages/contracts/src/canonical.ts`)
  rejects floats deliberately.
- **Every AI-derived row carries provenance** — `source`, confidence, source document.
  Uncited dates never become obligations.

## Scope defense

Requests outside the PRD get one test: *does this retire a risk in the register
(`ops/assumption-ledger.md` H1–H15) more cheaply than something already in scope?*
Almost always no → it goes on the postponed list with a reason. Notably postponed and
**not** to be reintroduced without a PRD amendment: chat assistant, agent execution +
approval machinery, multi-user logins, Plaid, native apps, public API.

## Working agreements

- Definition of done: acceptance criteria (PRD §19) + tests + analytics wired + security
  constraints. Not "it runs".
- Tenant-isolation tests must pass before any feature merges (`pnpm test:integration`).
- A migration PR states: lock impact, table size at 100k households, rollback story.
- Prefer deleting scope to adding abstraction.

## Local development

```bash
pnpm install
pnpm db:up                 # docker compose: postgres (pgvector) + redis
pnpm --filter @autobureau/db exec prisma migrate deploy
pnpm build && pnpm typecheck && pnpm test
pnpm test:integration      # requires the database
```

Integration tests need two connections: `DATABASE_ADMIN_URL` (superuser, seeds fixtures,
bypasses RLS) and `DATABASE_URL` (`app_user`, RLS applies — all assertions run here).
A test that passes on the admin connection proves nothing.

## Repository map

```
apps/                 (not yet created — walking skeleton lands here post-G1)
packages/contracts/   Zod schemas, event taxonomy, canonical hashing — source of truth for shapes
packages/db/          Prisma schema, RLS migrations, scoped client, outbox
docs/                 governing documents (above) + TRACEABILITY.md
ops/                  assumptions.yaml (+ schema/tests), ledger, dashboard, P0 validation kit
```

Next engineering work is scoped in `docs/product/pre-g1-backlog.md` — Tier 1 only until the gate.
