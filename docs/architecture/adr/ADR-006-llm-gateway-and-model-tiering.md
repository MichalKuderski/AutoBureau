# ADR-006: Provider-agnostic LLM gateway; Claude-primary with model tiering

**Status:** Accepted (2026-07-28; not yet implemented) · **Date:** 2026-07-22

## Context
The brief lists both the Anthropic SDK and OpenAI SDK. Unmanaged, that becomes provider imports scattered through business logic, no unified cost/reliability story, and a rewrite whenever the model landscape shifts (it shifts quarterly).

## Decision
1. **One internal gateway module** in `services/ai` owns all provider access (clients, routing, retries, fallback, budgets, caching, redaction, metering). No other code — in either runtime — imports a provider SDK. Built in-repo, not a SaaS proxy: our routing logic is simple, and a proxy vendor in the request path is another subprocessor for sensitive prompts.
2. **Named routes, not model names, in application code** (`extract.structured`, `chat.assistant`, …). Route → (model, effort, fallback chain, budget) lives in config (doc 04 §1); changing a model is a config deploy gated by evals (doc 11 §2.3).
3. **Claude-primary tiering:** Haiku 4.5 for high-volume classification; Sonnet 5 for structured extraction and batch analysis; **Opus 4.8 for chat and agentic workflows** (the product's voice and judgment — quality is the moat; adaptive thinking on). Fallback ladder (amended in review, A4/F-06): first fallback is the **same Claude model on AWS Bedrock** — identical weights, independent control plane, no new subprocessor or behavioral surface. OpenAI is last resort and enabled only for `chat.assistant`; extraction/autopilot routes queue and drain on recovery rather than degrade. All fallback runs stamped `degraded_provider` so the quality delta is measured, not assumed.
4. **Embeddings:** Voyage `voyage-3.5`, 1024-d, behind the same gateway; dimension pinned in the schema — an embedding-model change is a re-embed migration by design, never an in-place swap.
5. Cost architecture: prompt caching (frozen prefixes), Batches API for all non-interactive work, per-household budgets (doc 04 §8).

## Consequences
- ✅ Model churn becomes config + eval runs; unified cost metering per household/route; single choke point for redaction and provider allowlisting (doc 12 T9).
- ✅ Unit economics are steerable per route (doc 14 §4) without touching product code.
- ⚠️ Fallback across providers is behavioral, not just API-shaped — prompts are written provider-portable and the eval suite runs against fallback mappings too.
- ❌ Rejected: LiteLLM/proxy SaaS (extra subprocessor + abstraction we'd fight); "one big model everywhere" (fails the doc-14 cost table); "cheapest model everywhere" (fails the trust metric that *is* the product).
