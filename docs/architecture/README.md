# AutoBureau — Architecture Document Set

**Version:** 0.2.0-review · **Date:** 2026-07-23 · **Status:** ACCEPTED 2026-07-28 — frozen; amendments require evidence + an ADR
**Rule in force:** this set is frozen. Implementation proceeds against it; amendments require real-world
evidence plus an ADR (FOUNDING_PRINCIPLES §10). Product feature work is separately gated on G1 —
see `docs/product/pre-g1-backlog.md`.

> **2026-07-23 — Principal-panel architecture review completed:** [review/2026-07-23-principal-panel-review.md](review/2026-07-23-principal-panel-review.md). Findings: 3 blockers, 6 majors, 10 minors/watches. Amendments **A1–A9** applied throughout this set (marked inline as `review A#/F-##`). Highlights: RLS `SET LOCAL` plumbing fully specified (A1), chat streams direct from the AI edge (A2), exact per-tenant KNN replaces global HNSW (A3), Bedrock-first LLM fallback (A4), draft/execute plane split so the AI runtime never sees secrets (A5), RFC 8785 approval hashing (A6), Vercel/Cloudflare edge split (A7), launch-schema entitlements (A8), Langfuse pinned US (A9).

## Reading order

| # | Document | What it decides |
|---|----------|-----------------|
| 00 | [Product & scope](00-product-and-scope.md) | What v1 is, what it is explicitly not, personas, success metrics |
| 01 | [System architecture](01-system-architecture.md) | Topology, runtimes, vendor set, monorepo, where every kind of code lives |
| 02 | [Data model](02-data-model.md) | Full schema: households, items, obligations, documents, approvals, audit |
| 03 | [API design](03-api-design.md) | Conventions + complete v1 endpoint catalog + key flows |
| 04 | [AI architecture](04-ai-architecture.md) | LLM gateway, model tiering, LangGraph workflows, HITL, injection defense, evals |
| 05 | [Document pipeline](05-document-pipeline.md) | Ingestion channels, processing stages, storage, failure handling |
| 06 | [AuthN & AuthZ](06-auth-and-authorization.md) | Supabase Auth, sessions, household RBAC, RLS, service-to-service auth |
| 07 | [Jobs & events](07-jobs-and-events.md) | Transactional outbox, Redis Streams, schedulers, event taxonomy, idempotency |
| 08 | [Notifications](08-notifications.md) | Channels, preference model, digests, deliverability |
| 09 | [Infrastructure & deployment](09-infrastructure-and-deployment.md) | Environments, Terraform, CI/CD, secrets, migrations |
| 10 | [Observability & analytics](10-observability-and-analytics.md) | OTel, logging, SLOs, LLM tracing, product analytics |
| 11 | [Testing strategy](11-testing-strategy.md) | Test pyramid + AI evaluation harness + quality gates |
| 12 | [Security](12-security.md) | Threat model, encryption, field-level crypto, zero-trust posture |
| 13 | [Compliance & privacy](13-compliance-and-privacy.md) | GDPR/CPRA, retention matrix, DSRs, subprocessors, what we refuse to build |
| 14 | [Scaling roadmap](14-scaling-roadmap.md) | Phase triggers, cost model, what changes at 10k / 100k / 1M users |

## Architecture Decision Records

| ADR | Decision | Status |
|-----|----------|--------|
| [001](adr/ADR-001-modular-monolith-on-managed-platforms.md) | Two deployables on managed platforms, not microservices | Accepted · implemented |
| [002](adr/ADR-002-supabase-postgres-prisma.md) | Supabase as data platform; Prisma as ORM; RLS as defense-in-depth | Accepted · implemented |
| [003](adr/ADR-003-pgvector-over-dedicated-vector-db.md) | pgvector, not a dedicated vector database | Accepted · implemented |
| [004](adr/ADR-004-langgraph-on-fastapi.md) | LangGraph + FastAPI for all AI workflows; Postgres checkpointing | Accepted · not yet impl. |
| [005](adr/ADR-005-outbox-plus-redis-streams.md) | Transactional outbox + Redis Streams for events and jobs | Accepted · implemented |
| [006](adr/ADR-006-llm-gateway-and-model-tiering.md) | Provider-agnostic LLM gateway; Claude-primary with model tiering | Accepted · not yet impl. |
| [007](adr/ADR-007-field-level-encryption.md) | KMS envelope encryption for identifier-grade PII | Accepted · not yet impl. |
| [008](adr/ADR-008-rest-openapi-first.md) | Versioned REST + OpenAPI-first contracts (over tRPC/GraphQL) | Accepted · implemented |
| [009](adr/ADR-009-authenticated-request-boundary.md) | Authenticated request boundary: server-side session, household resolution, route protection, CSRF | Accepted · not yet impl. |
| [010](adr/ADR-010-per-request-csp-nonce.md) | Per-request CSP nonce in middleware; `script-src 'unsafe-inline'` removed | Accepted · implemented |

## Where I pushed back on the brief

The founder brief listed a technology wish-list. Four items were **not** adopted as written; each has an ADR:

1. **"Microservice-ready architecture"** → adopted as *boundaries and contracts*, not as services. We ship two deployables. Splitting further before ~50 engineers is self-harm (ADR-001).
2. **"Vector database"** → pgvector inside our existing Postgres. A dedicated vector DB at our scale is an extra vendor, an extra consistency problem, and an extra thing to delete during GDPR erasure (ADR-003).
3. **Supabase + Prisma together** → adopted, but with a strict access pattern (browser never queries the database; Prisma only via the server; RLS stays on as a second wall) because the naive combination silently bypasses RLS (ADR-002).
4. **OpenAI SDK + Anthropic SDK** → adopted behind one internal gateway with routing, budgets, and fallback — application code never imports a provider SDK directly (ADR-006).

## What most needs reviewer scrutiny

- The **obligation model** in doc 02 — it is the core abstraction; if it's wrong, everything above it is wrong.
- The **approval/action boundary** in docs 00 and 04 — what the agent may do without approval vs. with approval vs. never.
- The **cost model** in doc 14 — LLM spend per active user determines whether the business works at consumer price points.
- The **compliance stance** in doc 13 — especially the deliberate exclusions (no e-filing, no payments, no credential vaulting) and when/whether to revisit them.

## Open questions — resolved and outstanding

| # | Question | Status |
|---|---|---|
| 1 | Launch geography | **Resolved:** US-only (PRD §12; assumption H13, confidence high) |
| 2 | Pricing | **Provisional:** $12/mo · $99/yr in PRD F14, amendable on G1 evidence (assumption H2 — untested, existential) |
| 3 | Mobile | **Resolved:** responsive PWA (PRD F16); native deferred |
| 4 | Email ingestion domain | **Outstanding:** `in.autobureau.com` must be purchased before any ingestion work (blocks nothing pre-G1) |
