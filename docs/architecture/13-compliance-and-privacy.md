# 13 — Compliance & Privacy

Stance: US-first consumer product handling sensitive-but-mostly-unregulated personal records, built to GDPR-grade mechanics from day one because (a) CPRA/state laws converge there, (b) retrofitting deletion/export is 10× the cost, (c) trust is the product.

*This document defines the engineering posture; counsel reviews it before launch. It is not legal advice to ourselves.*

## 1. Regulatory map

| Regime | Applies? | Posture |
|---|---|---|
| CPRA/CCPA + state privacy laws (CO, VA, CT…) | Yes | Full DSR support (access/export/delete/correct), no sale/share of personal data — the business model is subscriptions, which keeps us out of the ugliest obligations |
| GDPR | Not at launch (US-only); mechanics built anyway | If/when EU: EU representative, data-residency review, DPIA — gated open question (README) |
| HIPAA | **No** — we are not a covered entity/BA; users store their *own* medical bills | Treat medical documents at the same protection tier as identity docs; never market "HIPAA-compliant"; revisit only if we ever integrate with providers/insurers |
| IRS e-file / tax prep rules | Avoided by scope | We organize tax documents; we never prepare or file (doc 00 §5) |
| GLBA / money transmission / PCI | Avoided by scope | No money movement; future payments only via Stripe-hosted surfaces (SAQ-A) |
| COPPA | N/A | 16+ ToS; children exist as `household_members` (data *about* them entered by a parent), not as users |
| CAN-SPAM / CASL + Gmail/Yahoo bulk rules | Yes | doc 08 §3/§5 |

## 2. Privacy principles (product-level commitments)

1. **No training on user data** — ours or providers'. Provider agreements must include no-training terms; ZDR/retention options evaluated per provider at contract time.
2. **No advertising, no data sale.** Subscriptions only.
3. **Data minimization:** we ask for nothing we don't structurally need; identifier-grade values are quarantined (doc 12 §5).
4. **Explainability:** every AI-derived fact shows its source document (provenance, doc 04 §2).
5. **Deletion is real** (§4), and we publish exactly what it does and how long backups persist.

## 3. Consent & transparency surfaces

Layered privacy notice (human-readable summary + full policy); in-product just-in-time notices at the three sensitive moments: enabling email ingestion ("mail sent here is processed by AI"), first document upload, inviting a household member (what they will see). Subprocessor list public (§7), change notice via email 30 d ahead.

## 4. Data subject requests (all self-serve, no email-a-human)

| Right | Mechanism | SLA |
|---|---|---|
| Access / portability | `POST /v1/exports` → zip: original documents + JSONL of all records + audit trail | ready ≤ 24 h, target minutes |
| Deletion (account) | `DELETE /v1/me` → grace period 14 d (undo) → cascade job | complete ≤ 30 d incl. weekly deletion-verifier sweep |
| Deletion (household) | owner-only, typed confirmation | same |
| Correction | the product *is* the correction surface (review/edit everywhere) | immediate |

Deletion cascade covers: rows (hard delete), chunks/embeddings, storage objects, Langfuse traces (API purge), PostHog person deletion, Resend suppression retained (legal basis: suppression lists are required to honor "don't email me"), Stripe per its retention. `deletion_receipts` records counts + completion. Backups age out ≤ 35 d — disclosed, not hand-waved.

## 5. Retention matrix

| Data | Retention | Rationale |
|---|---|---|
| Documents, registry, obligations | life of account | the product |
| Raw inbound MIME | 30 d | debugging/dispute, then value < risk |
| LLM traces (Langfuse) | 90 d | eval/debug window |
| Logs / traces (observability) | 30 d / 14 d | doc 10 §3 |
| Audit log | 2 y (account-scoped; deleted with account except security-incident holds) | dispute/forensics |
| Deleted-account backups | ≤ 35 d rolling | backup lifecycle |
| Eval corpus fixtures | indefinite, **only** consent-flagged or synthetic | doc 11 §4 |

## 6. Cross-border & residency

US processing at launch — Vercel/Supabase/AWS **and Langfuse** all pinned to US regions (review A9/F-11: the earlier EU-Langfuse exception was inconsistent with the stated residency posture). EU launch checklist parked in this doc's git history until the geography question (README) is answered.

## 7. Subprocessors (launch set)

Vercel, Supabase, AWS, Cloudflare, Upstash, Anthropic, OpenAI, Voyage, Resend, Sentry, Grafana Cloud, Langfuse, PostHog, Doppler, Stripe (post-launch). Each: DPA signed, purpose documented, data categories mapped, no-training terms where AI-relevant. Adding a subprocessor = ADR + notice cycle.

## 8. Breach readiness

Classification ladder (data classes × scope) pre-mapped to notification duties (state AG timelines vary; CPRA private right of action concentrates on precisely our data classes — this is the existential-risk scenario that justifies doc 12's spend). IR runbook + comms templates pre-written; cyber-liability insurance before launch.

## 9. Certification roadmap

SOC 2 is a B2C trust signal secondary to a good security page, but becomes table stakes for partnerships: Type I engagement at ~20k users / first enterprise conversation, Type II following. Controls in this doc-set are written to map onto SOC 2 CCs so the audit is evidence-gathering, not re-architecture.
