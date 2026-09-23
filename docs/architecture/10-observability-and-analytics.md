# 10 — Observability, Monitoring & Analytics

## 1. Stack

| Concern | Tool | Notes |
|---|---|---|
| Traces, metrics, logs | OpenTelemetry SDKs (both runtimes) → Grafana Cloud (Tempo/Mimir/Loki) | vendor-neutral wire format is the point |
| Errors | Sentry (web + AI service), release-tagged, sourcemaps | |
| LLM traces & evals | Langfuse (cloud, EU project) | per-run traces, token/cost, eval scores; self-hostable if compliance demands |
| Uptime & status | Better Stack: synthetic checks on `/v1/health`, chat round-trip, upload round-trip; public status page | |
| Product analytics | PostHog (server-side capture through our own proxy) | + feature flags |

One `trace_id` from browser request → web handler → outbox event id → worker → AI service → provider call; the outbox row and Redis message carry `traceparent` so async hops stay on the same trace.

## 2. Golden signals & dashboards

- **API**: rate, error %, p50/p95/p99 per route; saturation (Vercel concurrency, DB pool wait).
- **Pipeline**: docs by status, queue depth per stream, end-to-end latency histogram, failure rate by stage, review-queue depth & age.
- **AI**: per-route tokens/cost/latency, cache hit-rate, fallback rate, budget-cap hits, confidence distributions (drift in confidence = early warning of upstream document mix change or model regression).
- **Reminders**: scheduled vs sent vs delivered per day; **the** business-critical chart — a silent reminder outage is the worst incident this product can have short of a breach.
- **DB**: replication lag (later), bloat, slow-query log → weekly review ritual.

## 3. Logging rules

- Structured JSON only; every log line carries `trace_id`, `household_id` (hashed), route/workflow.
- **PII never in logs**: a shared redaction middleware (both runtimes) strips emails, names, document text, and any `item_secrets`-shaped values before emission; log-scrubber unit tests are part of the platform module. Prompts/completions go to Langfuse only (which is inside the DPA boundary, doc 13 §7) — never to Loki.
- Retention: 30 d logs, 14 d traces, 13 mo metrics.

## 4. SLOs & alerting

| SLO | Target | Window |
|---|---|---|
| API availability (5xx) | 99.9% | 30 d |
| API latency p95 (reads) | < 400 ms | 30 d |
| Chat first token p50 / p95 | < 1.5 s / < 4 s | 7 d |
| Document processed p90 | < 60 s | 7 d |
| Reminder send within 5 min of `remind_at` | 99.5% | 30 d |

Burn-rate alerts (fast 2%/1h + slow 5%/6h) page; everything else is a Slack ticket. Paging alerts at launch (deliberately few): SLO burns, DLQ non-empty 30 min, outbox lag > 5 min, budget-cap storm, backup-verification failure, Sentry new-issue spike.

## 5. LLM observability (Langfuse)

Every workflow run = trace with node spans, prompt version, model, tokens, cost, confidence, injection-screen verdict. Weekly review ritual: sample 20 `needs_review` traces + 10 random `processed` traces; findings become eval fixtures. Cost anomaly detection: per-household daily spend z-score → flags abuse or a looping workflow.

## 6. Product analytics

- Server-side events (from the outbox analytics consumer — the same facts the system already emits, so analytics can't drift from reality): activation funnel (signup → household → first doc → first auto-obligation → first approval), digest engagement, review-accept rate, obligation resolution.
- Autocapture off on document/review surfaces (screens full of PII); session replay off entirely at launch.
- North-star dashboard (doc 00 §6) reviewed weekly; the trust proxy (AI-proposal accept rate) feeds the eval-threshold governor (doc 11 §5).

## 7. On-call reality

Team-of-founders on-call: one rotation, alerts tuned brutally (anything that pages twice without action gets demoted or fixed), runbooks in `docs/runbooks/` from day one — the discipline is cheap now and impossible to retrofit during growth.
