# ADR-002: Supabase as data platform; Prisma as ORM; RLS as defense-in-depth

**Status:** Accepted (2026-07-28; implemented) · **Date:** 2026-07-22

## Context
The brief lists both Supabase and Prisma. The naive combination is a known trap: Prisma connects as a privileged role and silently bypasses RLS, while tutorials meanwhile encourage client-side supabase-js queries "because RLS protects you." Both halves of that default are wrong for a PII-heavy product.

## Decision
Adopt Supabase for **Postgres + Auth + Storage**, Prisma as the only ORM, with a strict access pattern:

1. **The browser never queries the database.** supabase-js is used client-side for auth session + signed storage operations only. All data access goes through `/v1`.
2. Prisma connects as a non-superuser `app_user` role through the transaction pooler; a scoped client extension injects `household_id` filters and wraps **every unit of work in an explicit `$transaction` opening with `SET LOCAL request.household_id`** (doc 06 §4–5; review A1/F-01 — the wrapper is mandatory: `SET LOCAL` is transaction-scoped, and session-level `SET` leaks across pooled connections). Transactions stay short (no external I/O inside); pool-wait p95 is paged; escape hatch: relocate `/v1` to a long-lived Node service, unchanged code.
3. **RLS stays enabled on every household-scoped table** and policies check the transaction-local setting — a second wall that catches scope bugs, raw-SQL mistakes, and any future direct-access surface.
4. `service_role` confined to migrations + two named jobs; CI-greppable.
5. RLS policies, triggers, and extensions live as SQL migrations in the same stream as Prisma migrations.

## Consequences
- ✅ One database with mature backup/PITR, auth without building it, storage with signed URLs; full SQL power (pgvector, FTS, partial indexes) that ORM-only stacks lose.
- ✅ Tenancy enforced twice, by different mechanisms, at different layers.
- ⚠️ `SET LOCAL` plumbing adds a little per-transaction overhead and requires the scoped-client discipline (mitigated: it's the *only* exported client).
- ⚠️ Supabase is the biggest SPOF (doc 01 §8) → own-S3 nightly dumps + quarterly restore drills.
- ❌ Rejected: Drizzle (fine tool; Prisma's migration ergonomics + team familiarity win, and the choice is swappable behind the repository layer); RDS + hand-rolled auth (weeks of undifferentiated work); client-side supabase-js data access (moves authz to policy-only, un-testable in TypeScript, and couples the browser to schema).
