# ADR-001: Two deployables on managed platforms, not microservices

**Status:** Accepted (2026-07-28; implemented) · **Date:** 2026-07-22 · **Deciders:** CTO, founding engineers

## Context
The founder brief asks for "microservice-ready architecture" and production-grade scalability. The team at implementation start is ≤6 engineers. The domain splits naturally along one seam only: TypeScript product domain vs Python AI runtime.

## Decision
Ship exactly two deployables — `apps/web` (Next.js: UI + domain API) and `services/ai` (FastAPI + LangGraph, also run in worker mode) — on managed platforms (Vercel, ECS Fargate, Supabase, Upstash). "Microservice-ready" is delivered as **seams, not services**:

1. Enforced module boundaries inside each deployable (lint-enforced public surfaces, doc 01 §3).
2. All async coupling through the outbox/event bus (ADR-005) — extracting a consumer into a service changes deployment, not code shape.
3. All sync coupling through the versioned contract package (ADR-008).
4. Tenancy key (`household_id`) on every row — the future sharding/cell key exists from day one.

## Consequences
- ✅ One deploy story, one on-call surface, no distributed-transaction problems, dramatically faster iteration; boundaries are still real enough that doc 14's extraction triggers are bounded projects.
- ⚠️ Discipline is load-bearing: boundary erosion is the failure mode → dependency-cruiser CI checks + quarterly boundary review.
- ⚠️ Vercel/Supabase concentration risk → escape hatches documented (doc 01 §5), backups to our own S3 (doc 09 §7).
- ❌ Rejected: NestJS/microservices from day one (org-chart solution without the org); single-runtime (forcing AI into Node or CRUD into Python wastes each ecosystem's strengths); serverless-everything for the AI tier (long-running graph executions and queue consumers fit containers, not lambdas).

## Revisit when
Any doc-14 Phase-2 tripwire fires, or team > ~25 engineers with clear ownership seams.
