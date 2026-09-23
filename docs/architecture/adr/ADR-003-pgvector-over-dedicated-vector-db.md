# ADR-003: pgvector, not a dedicated vector database

**Status:** Accepted (2026-07-28; implemented) · **Date:** 2026-07-22

## Context
The brief lists "vector database." Retrieval load: per-household chunk search (thousands to low-tens-of-thousands of vectors per tenant), always pre-filtered by `household_id`, fused with Postgres FTS. Projected corpus at 100k households ≈ 300M vectors — but *queries never span tenants*.

## Decision
pgvector (cosine, 1024-d) inside the existing Supabase Postgres. Hybrid search = FTS + vector with reciprocal-rank fusion in SQL.

**Amended in review (A3/F-05): no global HNSW index at launch.** Queries never span tenants and a household's corpus is thousands of chunks, so retrieval is **exact KNN** over the btree-prefiltered household (`ORDER BY embedding <=> $q`) — exact recall, zero index maintenance, and it sidesteps the filtered-HNSW post-filter recall pathology entirely. ANN (per-partition HNSW) returns to the table only if per-household corpora exceed ~50k chunks.

## Rationale
1. **Our retrieval is tiny per query.** Tenant pre-filtering means effective search space is one household, not the corpus. Dedicated vector DBs earn their keep on cross-corpus ANN at scale we structurally never perform.
2. **Transactional consistency:** chunk rows, embeddings, and the documents they cite live in one database — no sync pipeline, no "vector store says yes, DB says deleted."
3. **GDPR-grade deletion stays one cascade** (doc 13 §4). A second store is a second thing to provably erase.
4. **One backup/restore/RLS story.** RLS applies to `document_chunks` like any table.
5. Cost: $0 marginal vs a five-figure annual vendor + egress.

## Consequences
- ✅ Radically simpler ops and compliance; hybrid search in one query.
- ⚠️ Index build/maintenance pressure on the main DB as chunks grow → Phase-1 partitioning plan (doc 14).
- ⚠️ HNSW memory residency competes with OLTP working set → watch replica-sizing tripwire.
- ❌ Rejected: Pinecone/Weaviate/Qdrant now (premature; consistency + deletion costs, zero query-pattern benefit).

## Exit criteria (pre-committed, so the debate is data not vibes)
Move to a dedicated store only when **either** (a) p95 hybrid-search latency > 500 ms with tuned indexes and a dedicated replica, **or** (b) vector working set forces DB instance sizing more than 2 tiers above OLTP needs. Migration path: dual-write behind the retrieval interface (already a single module), backfill, flip, drop.
