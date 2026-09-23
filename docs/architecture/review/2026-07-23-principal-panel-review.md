# Architecture Review — Principal Panel (Simulated)

**Date:** 2026-07-23 · **Subject:** AutoBureau architecture set v0.1.0-review (docs 00–14, ADR-001–008)
**Method:** six adversarial review seats modeled on principal-engineer archetypes from OpenAI, Anthropic, Stripe, Notion, Linear, and Vercel. Every finding is anchored to a specific mechanism in the docs — no vibes-based objections admitted. Findings register in §8; amendments applied to the doc set in §9.

## 1. Verdict

**Conditionally approved.** The macro-architecture (two deployables, outbox spine, approval-gated agency, household tenancy, contract-first API) survived review intact. But the panel found **3 blockers** — bugs in the design that would have shipped as production incidents — plus 6 majors and a tail of minors. All blockers and 5 of 6 majors are resolved by amendments A1–A9 (§9), already applied to the doc set (now v0.2.0-review). One major (F-09, tri-cloud latency) is accepted as a measured risk with a tripwire.

The most important sentence in this review: **the original design contained an internal contradiction (F-02) and a correctness landmine (F-01) that no amount of testing philosophy would have caught before users did.** This is why the review gate exists. It worked.

---

## 2. Seat: Serverless & Edge Infrastructure (Vercel archetype)

### F-01 · BLOCKER — `SET LOCAL` RLS plumbing is incompatible with the connection topology as written
Doc 06 §5 sets `request.household_id` via `SET LOCAL` per transaction, while doc 01 runs Prisma from Vercel serverless functions through Supabase's **transaction-mode pooler**. Three interacting facts the design glossed over:
1. `SET LOCAL` only survives inside an explicit transaction — so *every* scoped query must be wrapped in an interactive transaction or the GUC silently never applies and **RLS denies everything** (or worse, a session-level `SET` would *leak the previous tenant's ID across pooled connections*).
2. Prisma interactive transactions pin a pooled connection for their duration — under serverless burst concurrency this converts a pooler into a queue.
3. None of this fails loudly in dev, where a single warm connection hides all of it.

**Disposition: amended (A1).** The scoped client *must* wrap every unit of work in `$transaction` with a leading `SET LOCAL`, transactions are short-by-construction (no external I/O inside), pool-wait p95 becomes a paged metric, and the pre-agreed escape hatch (move `/v1` onto a long-lived Node service beside the AI service, unchanged code — the API was built portable) is written down *before* it's needed. The defense-in-depth rationale for RLS stands (ADR-002); the plumbing spec was underspecified to the point of being wrong.

### F-03 · BLOCKER — Cloudflare-in-front-of-Vercel is a known operational tarpit
Doc 09 §3 implied Cloudflare proxying ahead of the Vercel-hosted app (SG allowlists "Cloudflare + Vercel ranges"). Double-CDN over Vercel is a documented source of challenge loops, cache-header fights, and broken ISR — and Vercel's own guidance is DNS-only. Meanwhile the SG allowlist of "Vercel egress ranges" is security theater: those ranges are shared by every Vercel customer.
**Disposition: amended (A7).** Split the edge: `app.autobureau.com` → DNS-only to Vercel, protected by Vercel's WAF/rate-limiting; Cloudflare fully proxies only what it's uniquely good for here — `in.autobureau.com` (Email Routing), `ai.autobureau.com` (SSE edge, see F-04), and the marketing site. The ALB is treated honestly as *public-with-JWT*: the service JWT (5-min, aud-scoped) is the actual control; IP allowlists are removed from the design rather than pretended at.

### F-04 · MAJOR — Chat SSE proxied through Vercel functions is paying twice for a worse stream
Doc 04 §5.4 streamed provider → FastAPI → **Next.js proxy** → client. That holds a Vercel function open for the whole generation (duration limits + invocation-time billing) and adds a hop to the product's most latency-visible path — and doc 14 even admitted it, deferring the fix to Phase 1. If you know a design decision's expiry date at design time, it's the wrong decision.
**Disposition: amended (A2).** Day one: `/v1` mints a single-use, conversation-scoped stream token (60 s, `aud: ai-stream`); the browser opens SSE **directly** against `ai.autobureau.com`. Chat bytes never transit Vercel. This also deletes a class of proxy-buffering bugs.

### F-09 · MAJOR — Tri-cloud request path (Vercel → Supabase → AWS) latency/egress is asserted, not budgeted
Every write touches two clouds; pipeline touches three. **Disposition: accepted with controls** — all three pinned to us-east-1/IAD-adjacent regions, a synthetic cross-hop latency check in Better Stack from day one, and egress cost line-itemed on the doc-10 cost dashboard. Re-platforming the API (per F-01's escape hatch) also collapses a hop if measurements demand it.

---

## 3. Seat: API & Correctness (Stripe archetype)

### F-02 · BLOCKER — The execution plane contradicted the encryption plane
ADR-007 says the AI runtime holds **no KMS decrypt grant** — correctly. But doc 04 §5.3 placed the task-autopilot *executors* (`render_pdf`, `send_email`) inside the LangGraph graph in the AI service. A form-fill executor that needs a passport number therefore either (a) can't work, or (b) someone "fixes" it in month 3 by granting the AI runtime decrypt — quietly destroying the architecture's best security property.
**Disposition: amended (A5).** Clean split: the **AI service plans and drafts, always with placeholders** (`{{passport_number}}`); the **web runtime's privileged execution module** is the only place approved payloads execute and the only place placeholders are substituted, after approval-hash verification. Bonus: the model now never sees identifier-grade values *even in its own drafts*, which strengthens the injection story beyond the original design.

### F-07 · MAJOR — Cross-runtime canonical-JSON hashing is a bug class, not a detail
Doc 04 §6's approval hash is computed in Python (drafting) and re-verified in TypeScript (execution). "Canonical JSON" hand-waved across two languages = eventual hash mismatches on unicode, number formatting, or key ordering — which in this design **fails closed on legitimate approvals** (an availability bug wearing a security costume).
**Disposition: amended (A6).** RFC 8785 (JCS) mandated on both sides, implementations pinned, and cross-runtime test vectors live in `packages/contracts` so CI proves byte-equality forever.

### F-08 · MAJOR — Free-tier caps are load-bearing for unit economics but had no enforcement design
Doc 14 §4's margin math depends on capping free-tier pipeline volume; doc 02 had no entitlements model and billing was "post-launch, feature-flagged." That's how you ship a free tier whose COGS is discovered from the invoice.
**Disposition: amended (A8).** `entitlements` (plan, caps) + monthly usage counters land in the schema pre-launch; the LLM gateway's budget check reads entitlements, and cap-exceeded is a designed product state ("processing resumes on the 1st / upgrade"), not an error.

### Endorsed without change
Idempotency-Key semantics, cursor pagination, problem+json, `oasdiff` breaking-change gates, and REST-over-tRPC/GraphQL (ADR-008) — the two-runtime argument is decisive; this seat has watched GraphQL resolver authz become the top vulnerability class in tenancy-critical products. Minor accepted risks logged: Redis-backed idempotency keys lost on flush (24 h window, tolerable), duplicate-notification defense should rely on the DB unique key `(notification_id, channel)` as the final arbiter (implementation note, F-13).

---

## 4. Seat: AI Systems & Safety (Anthropic archetype)

### F-06 · MAJOR — Cross-provider fallback buys availability with your two scarcest currencies: subprocessor surface and behavioral consistency
ADR-006 mapped OpenAI as *the* fallback. That routes sensitive prompts to a second AI vendor during any primary incident, and behavioral deltas mean fallback output quality is a coin-flip precisely when you're least watching.
**Disposition: amended (A4).** Fallback ladder becomes: (1) **same Claude models via AWS Bedrock** — same weights, different control plane, and we already run in AWS; (2) OpenAI only as last resort and only for `chat.assistant` (extraction and autopilot *queue and wait* rather than degrade — a delayed extraction is recoverable, a subtly wrong one is not). This shrinks both the compliance and the eval surface.

### Defended: tool-less extraction, capability-typed executors, approval gates with hash re-verification, injection canaries as deploy blockers
This is the correct shape and the panel wants it stated plainly: **the design's decision to make "read hostile content" and "possess capabilities" mutually exclusive model states is its single best property.** With A5, even drafted artifacts exclude secrets. Two hardenings requested (accepted as implementation requirements, no doc change): citation IDs returned by chat must be *validated against the retrieval set actually used* (an injected instruction must not be able to fabricate provenance chips), and the injection-canary corpus gets a named owner and a monthly growth ritual, because a canary suite that stops growing is a placebo.

### Watch: LangGraph pinning (ADR-004)
Version churn risk is real; the mitigation (pinned versions, our-own-Postgres checkpointing, graphs small enough to rewrite) is adequate. The panel adds: **no `langchain` ecosystem imports beyond LangGraph core** should be a lint rule, not a sentence in a doc.

---

## 5. Seat: Retrieval & Scale (OpenAI archetype)

### F-05 · MAJOR — The global HNSW index is the wrong tool and would have degraded exactly when it mattered
Doc 02 specified a global HNSW over what becomes ~300M vectors, filtered by `household_id`. Two problems: (1) HNSW + highly-selective post-filtering has a known recall pathology — the graph walk returns neighbors that mostly fail the filter, so per-tenant recall collapses or `ef_search` costs explode; (2) it's solving a problem the workload doesn't have — **queries never span tenants, and a household's corpus is thousands of chunks, not millions.**
**Disposition: amended (A3).** Launch design: *no vector index at all* — exact KNN (`ORDER BY embedding <=> $q`) over the btree-prefiltered household's chunks. Exact recall, zero index maintenance, faster than filtered-ANN at this cardinality. ANN returns to the table only if per-household corpora exceed ~50k chunks (tripwire added to doc 14). ADR-003's pgvector conclusion *strengthens* — the panel notes the original doc reached the right vendor decision partly via the wrong index design.

### Cost model spot-check (doc 14 §4)
Assumptions audited: 20 docs × ~10 pages × ~1.5k image-tokens/page on Sonnet ≈ $0.85–0.95 — arithmetic holds; the Opus-escalation line is the volatile term (10% assumed; if real-world scan quality pushes it to 25%, COGS +$0.35). Verdict: model is honest, the *sensitivity* is now flagged on the cost dashboard spec. Batches for radar and the A4 queue-don't-degrade policy both survive this seat's scrutiny.

---

## 6. Seat: Product Data & Permissions (Notion archetype)

**Defended: the item/obligation split and household-not-org tenancy.** The panel probed hardest at whether `obligations` should be derived-on-read from items rather than materialized rows, and concluded materialization is right: obligations carry independent lifecycle (snooze, dismiss, evidence, resolution) and the reminder scheduler needs indexed rows, not a view. The `household_users` (access) vs `household_members` (subjects) split is the kind of distinction usually retrofitted painfully in year two; having it in v1 is commended.

**F-19 · WATCH — the review queue is the hidden product risk.** The architecture routes all low-confidence AI output to human review — correct — but that makes review-queue UX the de-facto ceiling on trust *and* the labeled-data flywheel. If it's clunky, users ignore it, auto-apply thresholds can't rise, and the product plateaus. Not an architecture change; elevated to a first-class product workstream with its own metrics (queue age, accept latency) already present in doc 10.

**Minor:** member deletion within a household needs the same receipts rigor as household deletion (fold into doc 13 §4 at implementation); invite tokens should be single-use + 7-day expiry (implementation note).

---

## 7. Seat: Pragmatism & Team Reality (Linear archetype)

### F-10 · MAJOR (challenged, then defended) — Two languages for six engineers
The panel's sharpest generalist question: LangGraph.js exists — why carry Python's CI, packaging, and hiring surface at all? Deliberated and **defended, 5–1**: the Python advantage isn't LangGraph, it's the *gravity well around it* — pypdfium/document tooling, eval harnesses, the direction the AI-labs ecosystem ships in first. The mitigations (OpenAPI-generated Pydantic models, one `turbo` entry point, contracts as the only shared surface) cap the tax. The dissent is recorded: if the AI service's non-LangGraph Python surface stays trivial after 6 months, revisit consolidating to TS.

### F-18 · Challenged, then defended — Redis at all?
A Postgres-only spine (pgmq / SKIP-LOCKED job table) would delete a vendor and run in one container. Defended: Redis is already load-bearing for rate limiting and idempotency (sub-ms, cross-runtime); Streams' consumer-group semantics beat hand-rolled `SKIP LOCKED` fan-out for multiple independent consumers per event; and ADR-005's outbox means the transport was never the load-bearing choice anyway. The alternative is recorded as viable, not adopted.

**Endorsed loudly:** docker-compose-complete local dev, `fake-LLM` mode, boring REST, PWA-before-native, tripwires-not-prophecy scaling (doc 14 §2's refuse-to-prebuild list "reads like it was written by someone who has cleaned up the alternative").

**F-16/F-20 · minors:** the 300-doc eval corpus is founder-labor — schedule it like engineering work; reminder scheduling across DST transitions needs explicit test fixtures (the `remind_at` materialization design makes this tractable — compute in user-tz, store UTC, recompute on tz change).

---

## 8. Findings register

| ID | Severity | Finding | Verdict | Disposition |
|----|----------|---------|---------|-------------|
| F-01 | **Blocker** | `SET LOCAL` RLS × transaction pooling × serverless underspecified → tenant-leak/deny-all risk | Sustained | **A1** applied |
| F-02 | **Blocker** | Executors in AI runtime contradict no-decrypt-grant property | Sustained | **A5** applied |
| F-03 | **Blocker** | Cloudflare-proxy-over-Vercel topology conflict; SG allowlist theater | Sustained | **A7** applied |
| F-04 | Major | Chat SSE through Vercel functions: cost/duration/latency | Sustained | **A2** applied |
| F-05 | Major | Global HNSW + tenant post-filter recall pathology; ANN unnecessary | Sustained | **A3** applied |
| F-06 | Major | Cross-provider fallback: subprocessor + behavioral surface | Sustained | **A4** applied |
| F-07 | Major | Cross-runtime canonicalization bug class in approval hashing | Sustained | **A6** applied |
| F-08 | Major | Entitlement enforcement missing; free-tier caps load-bearing | Sustained | **A8** applied |
| F-09 | Major | Tri-cloud latency/egress unquantified | Accepted risk | Region pinning + synthetic checks + cost line-item; F-01 escape hatch collapses a hop if needed |
| F-10 | Major | Two-language tax | **Defended** (5–1) | Revisit clause recorded (6-mo check) |
| F-11 | Minor | Langfuse EU vs US-pinned processing inconsistency | Sustained | **A9** applied |
| F-12 | Minor | Prisma vs future partitioned tables | Noted | Raw-SQL migration escape hatch (already the pattern for RLS) |
| F-13 | Minor | Duplicate notification under at-least-once | Noted | DB unique `(notification_id, channel)` is final arbiter — implementation requirement |
| F-14 | Minor | Idempotency keys volatile in Redis | Accepted | 24 h window; documented behavior |
| F-15 | Minor | "Vercel ranges" SG allowlist weak | Sustained | Folded into A7 (JWT is the control; allowlist removed) |
| F-16 | Minor | Eval-corpus labeling is unscheduled founder labor | Noted | Scheduled as engineering work pre-launch |
| F-17 | Minor | Outbox growth | Defended | 30 d → S3 archive already designed |
| F-18 | Minor | Postgres-only queue alternative | **Defended** | Recorded as viable; Redis kept (multi-role) |
| F-19 | Watch | Review-queue UX is the trust ceiling | Product | First-class workstream + existing metrics |
| F-20 | Watch | DST/timezone reminder correctness | Noted | Test fixtures required (doc 11 unit layer) |

## 9. Amendments applied (v0.1.0 → v0.2.0-review)

| ID | Change | Docs touched |
|----|--------|--------------|
| A1 | RLS plumbing fully specified: `$transaction`-wrapped scoped client, short-tx rule, pool-wait paging, portability escape hatch | 06 §5, ADR-002 |
| A2 | Chat streams browser→AI edge directly via single-use stream token; Vercel proxy deleted from design | 01 §1, 03, 04 §5.4, 06 §6, 14 |
| A3 | No vector index at launch; exact per-household KNN; ANN tripwire at ~50k chunks/household | 02 §3, ADR-003, 14 |
| A4 | Fallback ladder: Claude-on-Bedrock first; OpenAI last-resort chat-only; extraction queues rather than degrades | 04 §1, ADR-006 |
| A5 | Execution plane: AI drafts with placeholders; web-runtime privileged executor substitutes secrets post-approval | 04 §5.3–6, ADR-007 (consistent) |
| A6 | RFC 8785 (JCS) canonicalization + cross-runtime test vectors in contracts | 04 §6 |
| A7 | Edge topology split: Vercel WAF for app host (DNS-only); Cloudflare proxies email/AI-edge/marketing; ALB = public-with-JWT, stated honestly | 09 §3 |
| A8 | `entitlements` + usage counters in schema pre-launch; gateway budgets read entitlements | 02 §10, 14 §4 |
| A9 | Langfuse pinned to US project | 13 §6 |

## 10. Conditions to begin implementation

1. Founder answers the four open questions in the architecture README (geography, pricing, PWA, ingestion domain).
2. ADRs 001–008 flipped from *Proposed* to *Accepted* (as amended) by the founder.
3. First implementation milestone is **walking-skeleton order**: contracts package + CI gates + scoped-DB client with the A1 pattern + outbox/dispatcher + one end-to-end thread (upload → classify → obligation → reminder email) before any feature breadth.
4. F-13/F-16/F-20 implementation notes carried into the milestone tracker so they don't evaporate.
