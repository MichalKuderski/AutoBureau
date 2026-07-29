# 03 — API Design

One versioned REST API, OpenAPI-first (ADR-008). The contract in `packages/contracts` is the source of truth: Zod schemas → OpenAPI 3.1 → generated TS client (used by our own UI — we are customer zero of our public API) and Pydantic models for the AI service. Public API access for third parties is a later product decision; the discipline starts now so it's a toggle, not a rewrite.

## 1. Conventions

| Concern | Rule |
|---|---|
| Base path | `https://app.autobureau.com/v1` (Next.js route handlers) |
| Versioning | Path major version. Additive changes don't bump; breaking changes create `/v2` with ≥6-month overlap |
| Auth | Supabase session JWT (cookie for browser, `Authorization: Bearer` for API) — doc 06 |
| Household scoping | `X-Household-Id` header, validated against membership on every request; single-household users get a default (doc 06 §4) |
| IDs | UUIDv7, opaque to clients |
| Pagination | Cursor-based: `?cursor=&limit=` (max 100); response `{data, next_cursor}` |
| Filtering/sorting | Explicit whitelisted params per endpoint (`?status=upcoming&due_before=...`) — no generic query language |
| Errors | RFC 9457 `application/problem+json`: `{type, title, status, detail, instance, errors?[]}`; stable `type` URIs are part of the contract |
| Idempotency | `Idempotency-Key` header honored on all POSTs with side effects; keys stored 24h in Redis, replayed responses returned verbatim |
| Rate limits | Per-user + per-IP token buckets (doc 12 §7); `429` with `Retry-After`; headers `RateLimit-*` |
| Timestamps | RFC 3339 UTC everywhere; user timezone applied only at render/scheduling |
| Deprecation | `Deprecation` + `Sunset` headers, tracked in contract changelog |

## 2. Endpoint catalog (v1)

### Identity & household
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/me` | Profile + memberships + capabilities |
| PATCH | `/v1/me` | Profile, timezone, locale |
| DELETE | `/v1/me` | Starts account deletion workflow (doc 13 §4) — 202 |
| GET/POST | `/v1/households` | List mine / create |
| GET/PATCH/DELETE | `/v1/households/{id}` | Delete: owner-only, typed-confirmation, 202 async |
| GET/POST | `/v1/households/{id}/members` | Household members (people, not logins) |
| PATCH/DELETE | `/v1/households/{id}/members/{mid}` | |
| POST | `/v1/households/{id}/invites` | Invite a login (role: member/viewer); email + expiring token |
| POST | `/v1/invites/{token}/accept` | |
| POST | `/v1/households/{id}/email-alias` | Provision/rotate ingestion alias |

### Documents
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/documents/uploads` | Returns short-lived signed upload URL + `document_id` (status `received`) |
| POST | `/v1/documents/{id}/complete` | Client confirms upload → outbox `document.uploaded` → pipeline |
| GET | `/v1/documents` | Filter: `status, doc_type, member_id, q` (full-text) |
| GET | `/v1/documents/{id}` | Metadata + extraction + provenance links |
| GET | `/v1/documents/{id}/download` | Signed download URL, 60 s TTL, audit-logged |
| POST | `/v1/documents/{id}/review` | Accept/correct extraction; corrections feed the eval corpus (doc 11 §5) |
| POST | `/v1/documents/{id}/reprocess` | Re-run pipeline (e.g. after schema improvements) |
| DELETE | `/v1/documents/{id}` | Cascades chunks + storage object |

### Registry & obligations
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/v1/items` | Filter: `kind, member_id, status, expiring_within` |
| GET/PATCH/DELETE | `/v1/items/{id}` | PATCH validates `attrs` against the kind's schema version |
| GET | `/v1/items/{id}/timeline` | Documents + obligations + task runs for one item |
| PUT | `/v1/items/{id}/secrets/{field}` | Write-only; response returns `last4` only (doc 12 §5) |
| GET/POST | `/v1/obligations` | Filter: `status, kind, due_before, member_id, priority` |
| GET/PATCH | `/v1/obligations/{id}` | |
| POST | `/v1/obligations/{id}/complete` \| `/dismiss` \| `/snooze` | Snooze body: `{until}` — reshuffles reminder rows |
| GET | `/v1/subscriptions/audit` | Subscription-auditor view: recurring items + detected anomalies (price hikes, zombies) |

### Automation
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/task-runs` | `{workflow, obligation_id?, input}` → 202 `{task_run_id}` |
| GET | `/v1/task-runs` / `/{id}` | Status + artifacts |
| GET | `/v1/task-runs/{id}/events` | SSE progress stream |
| POST | `/v1/task-runs/{id}/cancel` | |
| GET | `/v1/approvals` | Pending-first inbox |
| POST | `/v1/approvals/{id}/approve` | Body must echo `payload_sha256` — client proves it displayed what it approved |
| POST | `/v1/approvals/{id}/reject` | `{reason?}` — fed back to the workflow |

### Assistant
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/v1/conversations` | |
| GET | `/v1/conversations/{id}` | Message history |
| POST | `/v1/conversations/{id}/messages` | Persists the message and returns a single-use stream token; the client opens SSE directly against the AI edge `ai.autobureau.com` for the response (review A2). Citations reference `document_id`s |
| GET | `/v1/search?q=` | Hybrid search (FTS + vector) across documents/items/obligations — powers ⌘K |

### Notifications
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/notifications` | In-app feed; `?unread=true` |
| POST | `/v1/notifications/read` | `{ids}` batch |
| GET/PUT | `/v1/notification-preferences` | Matrix of kind × channel + quiet hours + digest day |
| POST | `/v1/push-subscriptions` | Web Push endpoint registration |

### Privacy & data
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/exports` | Full household export → 202; zip of documents + JSONL of records (doc 13 §4) |
| GET | `/v1/exports/{id}` | Status + signed download when ready |

### Webhooks (inbound, not user-facing)
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/webhooks/email-inbound` | From Cloudflare Email Worker; HMAC-signed, IP-restricted (doc 05 §2) |
| POST | `/v1/webhooks/resend` | Delivery events → `notification_deliveries` |
| POST | `/v1/webhooks/stripe` | Post-launch billing |

### Internal (AI service; not on the public gateway)
| Method | Path | Notes |
|---|---|---|
| POST | `/stream/chat` | **public AI edge** (`ai.autobureau.com`): browser connects directly with the single-use stream token minted by `/v1` (doc 06 §6, review A2) |
| POST | `/internal/pipeline/document` | worker → AI service |
| POST | `/internal/workflows/{name}/resume` | Approval decisions resume LangGraph threads (doc 04 §6) |
| GET | `/internal/health` `/internal/ready` | ALB checks |

## 3. Key flow: document upload

```mermaid
sequenceDiagram
    participant C as Client
    participant W as apps/web /v1
    participant S as Supabase Storage
    participant PG as Postgres
    participant K as Worker
    participant AI as AI service

    C->>W: POST /v1/documents/uploads {filename, mime, size}
    W->>PG: INSERT documents(status=received)
    W-->>C: {document_id, signed_url}
    C->>S: PUT file (signed URL, 15 min TTL, size-capped)
    C->>W: POST /v1/documents/{id}/complete
    W->>PG: tx: status=received→scanning + outbox(document.uploaded)
    Note over PG,K: dispatcher publishes to Redis Stream (doc 07)
    K->>K: malware scan + mime sniff (doc 05 §3)
    K->>AI: /internal/pipeline/document
    AI-->>PG: extraction, chunks, proposed items/obligations
    K->>PG: status=processed | needs_review + outbox events
    Note over C: UI updates via polling/SSE; needs_review lands in review queue
```

Direct-to-storage upload keeps multi-megabyte files out of Vercel functions; the size cap (25 MB) and content-type allowlist are enforced in the signed-URL policy *and* re-verified by the scanner (never trust the client's claim).

## 4. Contract governance

- Contract changes are PRs to `packages/contracts` with generated-diff comments (`oasdiff`) — breaking changes fail CI unless the PR carries a `contract-break` label + migration note.
- Every route handler is wrapped in a validator that 400s on schema mismatch **and** strips unknown fields on output (no accidental field leakage — this matters in a PII product).
- Contract tests (doc 11 §3) replay the OpenAPI examples against a real server in CI.
