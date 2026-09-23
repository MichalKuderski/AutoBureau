# ADR-008: Versioned REST + OpenAPI-first contracts (over tRPC / GraphQL)

**Status:** Accepted (2026-07-28; implemented) · **Date:** 2026-07-22

## Context
The brief demands "API-first design." Candidates: tRPC (fastest DX for a TS monorepo), GraphQL (flexible clients), REST+OpenAPI (boring, universal).

## Decision
Versioned REST (`/v1`) defined OpenAPI-first from Zod schemas in `packages/contracts`; generated TS client consumed by our own UI (we are customer zero); generated Pydantic models keep the Python service on the same contract. Conventions in doc 03 §1.

## Rationale
1. **The contract outlives the framework.** OpenAPI is consumable by the future mobile app, partners, support tooling, and the AI service — tRPC's contract is a TypeScript type graph usable only inside the monorepo, and our second runtime is Python.
2. **Two-runtime reality decides it.** The moment Python must honor the same shapes, tRPC's core advantage evaporates; codegen from OpenAPI serves both.
3. GraphQL solves flexible-query problems we don't have (one first-party client, well-known screens) at the cost of a resolver authz surface that is exactly the wrong risk profile for a tenancy-critical PII product (T1 in doc 12).
4. Boring wins on the review axis: rate limiting, caching, idempotency keys, problem+json, WAF rules — all standard practice on REST.

## Consequences
- ✅ One contract, three consumers (web UI, AI service, future public API); breaking-change detection in CI (`oasdiff`); the "public API" product decision later is a gateway toggle, not a build.
- ⚠️ More ceremony than tRPC for internal-only endpoints — accepted; codegen absorbs most of it.
- ⚠️ Some screens will over/under-fetch vs GraphQL — purpose-built read endpoints (e.g. `/items/{id}/timeline`) cover the hot cases.
- ❌ Rejected: tRPC (monorepo-only contract, Python left out); GraphQL (authz surface + N+1 discipline cost, no client diversity to justify it); server actions as the write path (framework-coupled, contract-invisible — actions are allowed only as thin wrappers over `/v1` calls, and the UI consumes the generated client).
