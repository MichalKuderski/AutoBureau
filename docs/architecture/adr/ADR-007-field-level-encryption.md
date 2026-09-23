# ADR-007: KMS envelope encryption for identifier-grade PII

**Status:** Accepted (2026-07-28; not yet implemented) · **Date:** 2026-07-22

## Context
Provider-level encryption at rest protects against stolen disks, not against the realistic threats: leaked DB credentials, SQL injection, a compromised service, an over-broad query. AutoBureau stores identifier-grade values (passport numbers, SSNs on tax docs, policy/account numbers) whose leak is identity-theft material and CPRA private-right-of-action territory.

## Decision
1. Identifier-grade values live **only** in `item_secrets` (doc 02 §4): AES-256-GCM per-value data keys, envelope-encrypted by an AWS KMS CMK; `key_version` recorded per row.
2. **Decryption capability exists in exactly one module** of the web runtime (the reveal endpoint + task-run form-filling executor). Worker and AI runtimes have no KMS decrypt grant on this key — the pipeline is architecturally unable to read these values; extraction hands them off write-only (doc 12 §5) and retains `last4`.
3. Every decrypt is audit-logged with actor and reason; reveal requires fresh session (≤15 min) re-auth.
4. Rotation: KMS annual automatic rotation + lazy re-wrap job driven by `key_version`.
5. Everything else (document blobs, names, addresses, amounts) relies on provider encryption + access control — full application-layer encryption of all content would destroy search/extraction utility for marginal gain against these threat vectors; the line is drawn at *identifier-grade* values and recorded here.

## Consequences
- ✅ DB dump or SQL injection yields ciphertext for the crown-jewel fields; blast radius of an AI-runtime compromise excludes them entirely.
- ⚠️ These fields are not queryable/searchable (acceptable: lookups use `last4` + item context); form-filling flows must route through the one privileged executor.
- ⚠️ KMS adds a hard AWS dependency to the reveal path — cached data keys with short TTL keep the p99 acceptable; KMS outage degrades reveal/form-fill only.
- ❌ Rejected: pgcrypto in-DB (keys and ciphertext co-located — defeats the point); full client-side E2EE (kills the product's core capability: the service must read documents to work; honest positioning over crypto theater); external tokenization vault SaaS (another subprocessor holding the worst data; revisit if compliance regimes demand it).
