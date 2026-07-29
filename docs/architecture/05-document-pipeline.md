# 05 — Document Processing Pipeline

The pipeline turns hostile bytes into trusted structure. It is the highest-risk surface in the product: malware, prompt injection, PII, and cost all concentrate here.

## 1. Ingestion channels

| Channel | Path | Notes |
|---|---|---|
| Direct upload | signed-URL flow (doc 03 §3) | Drag-drop, mobile camera (PWA); 25 MB cap, allowlisted types: PDF, JPEG/PNG/HEIC, EML |
| Email forwarding | per-household alias `h-{slug}@in.autobureau.com` | The retention feature. Users forward receipts/bills; power users add auto-forward rules in their mail client |
| Bulk import | multi-file upload with a progress queue | Onboarding moment: "empty that folder of PDFs into us" |
| API | same `/v1/documents` surface | Future partners; nothing special to build |

## 2. Email ingestion design

```
sender → Cloudflare Email Routing (catch-all on in.autobureau.com)
       → Email Worker: size check (≤25 MB), alias parse, spam headers
       → PUT raw MIME to Storage (inbound-raw bucket)
       → POST /v1/webhooks/email-inbound {alias, from, subject, storage_path} (HMAC-signed)
       → inbound_emails row + outbox(email.received)
       → worker: match alias → household; verify sender ∈ household users' addresses OR vendor-domain heuristic
       → split MIME: each attachment (and HTML body rendered to PDF when body-only receipt) becomes a `documents` row → normal pipeline
```

Security posture:
- Alias is a capability token (unguessable slug); rotation endpoint exists for when it leaks to spammers.
- Unknown-sender mail to a valid alias → `quarantined`, user notified in-app ("someone sent this — accept?") rather than silently processed. Prevents third-party injection into a household's registry.
- Raw MIME retained 30 days for debugging/dispute, then deleted (retention matrix, doc 13 §5).
- SPF/DKIM/DMARC results recorded; hard-fail DMARC from a claimed known sender → quarantine.

## 3. Processing stages (worker-side)

```
received → scanning → processing → processed | needs_review | rejected | failed
```

1. **Scan (sandbox, before any parsing):** ClamAV container scan; MIME sniffing (magic bytes, not extension); PDF triage (encrypted? JS-bearing? >500 pages?) → `rejected` with a user-comprehensible reason. Image formats normalized (HEIC→JPEG) via a hardened ImageMagick policy (no ghostscript delegates).
2. **Text layer:** born-digital PDFs → `pypdfium2` text; scans/photos → no local OCR in v1: the extraction model consumes page images directly (vision). Rationale: one quality path, no Tesseract-quality floor; cost handled by tiering + batches. Revisit if cost model demands a pre-OCR (doc 14).
3. **AI stages:** classify → extract → validate → link → propose (doc 04 §5.1).
4. **Chunk & embed:** semantic-ish chunking (~800 tokens, overlap 100), `document_chunks` + Voyage embeddings. Chunking happens *after* extraction so chunk metadata carries doc_type/date for retrieval filters.
5. **Apply or park:** thresholds per doc-type×field (doc 04 §5.1) decide auto-apply vs review queue.

## 4. Extraction schemas

Per-doc-type versioned schemas in `packages/contracts/extraction/` — e.g. `insurance_policy.v2.json`: carrier, policy_number→secret, coverage lines, premium, effective/expiry, insured members. Schema versions are recorded on each document (`extracted._schema`), so reprocessing and evals are reproducible. Adding a doc type = schema + few-shot examples + eval fixtures + review-UI field labels; it's a content-team-shaped task, deliberately not an engineering bottleneck.

## 5. Storage layout

| Bucket | Content | Access |
|---|---|---|
| `documents` | processed originals, path `hh/{household_id}/doc/{document_id}` | signed URLs (60 s) via API only; bucket private; RLS storage policies as backstop |
| `inbound-raw` | raw MIME, 30-day TTL | service-only |
| `artifacts` | generated PDFs/letters from task runs | signed URLs via API |

Encryption at rest: Supabase (AES-256) + our KMS field-layer for identifier-grade values (ADR-007). Antivirus verdict + sha256 stored on the row; identical `(household_id, sha256)` re-upload short-circuits to the existing document.

## 6. Failure handling

- Each stage idempotent + resumable (stage cursor on the pipeline state); retries with backoff ×3 → `failed` + DLQ (doc 07 §6) + ops alert if failure rate >2% over 15 min.
- User-facing failure states are honest and specific: "This PDF is password-protected — remove the password and re-upload" beats "processing failed."
- A stuck `scanning/processing` document (>15 min) is auto-requeued once, then failed — watchdog cron (doc 07 §5).

## 7. Throughput expectations

Launch design point: 1 doc/sec sustained, burst 10/sec (bulk imports). Each doc ≈ 1 scan + 1–3 model calls + 1 embed batch. Worker autoscaling on Redis Stream depth (target: queue drain < 5 min). At 100k households this becomes the first thing doc 14 re-architects (dedicated pipeline workers pool, pre-OCR tier, per-stage queues).
