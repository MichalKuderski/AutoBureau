# 14 — Scaling Roadmap & Cost Model

Principle: we scale on **triggers, not prophecy**. Every phase change below has a measurable tripwire; nothing is built before its tripwire fires. The architecture's job today is to make each change a bounded project, not a rewrite — that's what ADR-001's seams buy.

## 1. Phases

### Phase 0 → 10k households (launch architecture, as documented)
Everything in docs 01–13 as written. Single region, two deployables, Redis Streams, pgvector. Nothing to do here but ship and measure.

### Phase 1: 10k → 100k households

| Tripwire | Change |
|---|---|
| DB CPU > 60% sustained / read-heavy dashboards slow | Postgres read replica; move radar/analytics reads to it |
| Per-household corpora approach ~50k chunks or exact-KNN p95 degrades (review A3: launch design is exact per-tenant scan, no global HNSW) | Partition `document_chunks` by household hash + per-partition HNSW — **still pgvector** (ADR-003 as amended; exit criteria not yet met) |
| Queue consumer lag routinely > 5 min | Split worker pools per stream (pipeline vs notifications vs radar); scale dispatcher |
| Pipeline cost per doc > model target | Add cheap pre-OCR tier (Textract or open OCR) so vision-extraction runs only on pages that need it; more aggressive Batches usage |
| Vercel invocation cost bites on remaining hot paths (chat already streams direct from the AI edge per review A2) | Move the hottest endpoints to the AI-edge host, or execute the F-01 escape hatch (relocate `/v1` to a Node service on ECS — also collapses a tri-cloud hop, F-09) |
| Support load real | Build the consent-scoped support tooling (doc 12 §8) for real |

### Phase 2: 100k → 1M households

| Tripwire | Change |
|---|---|
| Redis Streams ops pain / multi-consumer topology complexity | Dispatcher target swaps to SQS/SNS or Kafka (outbox unchanged — ADR-005's designed seam) |
| pgvector recall/latency degrades at ~1B vectors or replica can't hold working set | Dedicated vector store (Turbopuffer/pgvector-on-dedicated/Vespa bake-off); ADR-003 exit executed with dual-write migration |
| Extraction throughput or team ownership boundaries | Document pipeline becomes its own service (first real microservice split — it already has its own queue, schema surface, and scaling profile; the seam was cut for this) |
| EU launch decision | EU region cell: separate Supabase project + AI service deployment, data residency by home region (cell architecture, not global replication) |
| Single Postgres write ceiling (~this scale for our write profile) | Household-sharded Postgres (household_id is already on every row and every query — the sharding key was chosen on day one) |
| Auth/SLA needs outgrow Supabase | Auth remains JWT-compatible → migrate to dedicated GoTrue deployment or WorkOS-style provider without token-format change |

### Phase 3: 1M+ (sketch, deliberately thin)
Multi-cell by geography; ML infra maybe in-house for embedding/classification (fine-tuned small models replace Haiku routes when volume justifies — the eval corpus doc 11 built is the training set); dedicated data platform (warehouse + CDC from outbox). Not designed further — designing this now would be fiction.

## 2. What we refuse to pre-build (and why that's the decision)

- Kubernetes (ECS is fine until a platform team exists)
- GraphQL federation / microservice mesh (no consumer needs it; ADR-008)
- Multi-region active-active (cost/complexity vs a single-digit-hours RTO product; revisit at Phase 2 with real SLA pressure)
- Custom model training (until eval corpus > 50k labeled docs and per-route volume makes unit economics obvious)

## 3. Latency & capacity design points (recap)

Launch design point: 1 doc/s sustained (10/s burst), 50 chat msg/s, 100k reminder sends/day — each with ≥10× headroom in the chosen managed tiers. Capacity re-baselined monthly with the k6 run (doc 11 §1).

## 4. Unit-economics model (the table investors will actually ask about)

Assumptions: active household = 20 docs/mo (10% needing Opus escalation), 30 chat messages/mo, weekly radar + monthly subscription audit. Prices: Haiku $1/$5, Sonnet 5 $3/$15, Opus 4.8 $5/$25 per MTok; Batches −50%; prompt-cache reads ≈ 0.1×.

| Workload | Est. cost / household / mo |
|---|---|
| Classification (Haiku, cached prompts) | $0.04 |
| Extraction (Sonnet vision, ~10 pages avg, structured) | $0.85 |
| Opus escalations (10% of docs) | $0.25 |
| Chat (Opus 4.8, heavy prompt-cache hits, 30 msgs) | $0.70 |
| Radar + subscription audit (Sonnet via Batches) | $0.12 |
| Embeddings (Voyage) | $0.02 |
| **LLM subtotal** | **≈ $1.98** |
| Infra amortized (Vercel/Supabase/AWS/Upstash/observability) at 10k households | ≈ $0.55 |
| **COGS / active household / mo** | **≈ $2.50** |

At $12/mo premium: ~79% gross margin on paying users. The free tier must therefore be capped by *pipeline volume* (e.g. 10 docs/mo, no Opus chat) — free-tier COGS target ≤ $0.40, **enforced by the launch-schema `entitlements` + gateway budget check (review A8), not by hope**. Sensitivity: extraction dominates; the Phase-1 pre-OCR tier and cache discipline are the two levers, and both are measured on the doc-10 cost dashboard from day one. **Every model-routing decision routes through this table + the eval gate — cost work that degrades eval scores doesn't ship.**

## 5. Standing review

This document is re-baselined quarterly against actuals (cost dashboard, capacity runs, tripwire metrics). A tripwire firing opens an ADR, not a panic.
