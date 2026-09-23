# 12 — Security Architecture

AutoBureau's data profile (identity documents, insurance, medical bills, financial paper) is worth more per-user to an attacker than almost any consumer app's. Security is a product feature here, not a compliance checkbox.

## 1. Threat model (STRIDE-condensed, top risks)

| # | Threat | Vector | Primary controls |
|---|---|---|---|
| T1 | Cross-tenant data access | authz bug, retrieval leak, IDOR | scoped Prisma client (type-level), RLS second wall, household-filtered vector search, tenancy fuzz tests (doc 11 §3) |
| T2 | Account takeover | credential stuffing, phishing, recovery abuse | pwned-password checks, MFA, rate limits, new-device notices, hardened recovery runbook |
| T3 | Prompt injection → unauthorized action | hostile document/email content | layered defense (doc 04 §7): tool-less extraction, typed capabilities, approval gates w/ payload hash, canary suite |
| T4 | Malware via uploads | PDF/image exploits | pre-parse sandboxed scanning, format allowlist, hardened parsers, no server-side rendering of user PDFs in web runtime |
| T5 | Bulk data theft (DB/storage compromise) | leaked creds, SSRF, supply chain | field-level encryption for identifier PII (ADR-007), private buckets + short signed URLs, egress posture, secrets hygiene (doc 09 §5) |
| T6 | Email-channel abuse | alias spam/poisoning, spoofed senders | capability-token aliases, sender verification, quarantine flow, DMARC checks (doc 05 §2) |
| T7 | Insider / support abuse | over-broad admin access | no standing prod access; break-glass with audited ECS Exec; support tooling reads via the same `can()` policy with an explicit consent-scoped support role (built before support exists) |
| T8 | Supply chain | malicious dependency, CI compromise | lockfiles + osv-scanner + minimal-permission GITHUB_TOKEN, OIDC (no cloud keys in CI), trivy on images, pinned actions |
| T9 | Model-provider data exposure | prompts contain user data | DPAs + no-training terms with providers, redaction layer strips secrets from prompts, provider allowlist in gateway |
| T10 | DoS / cost attack | upload floods, LLM-burn abuse | per-user/IP rate limits, upload caps, per-household AI budget (doc 04 §8), Cloudflare WAF |

## 2. Zero-trust posture (practical version)

- No implicit trust between components: browser↔web (session JWT), web↔AI (scoped service JWT, 5 min), workers (minted identity), webhooks (HMAC + timestamp). Every hop re-authenticates and re-authorizes against claims, never against network position.
- Least privilege: per-service DB roles (`app_user`, `worker`, `dispatcher`), IAM task roles scoped to exact ARNs, provider API keys per-env with spend caps.
- No standing human access to production data; access = break-glass + audit + postmortem note.

## 3. Encryption

- **Transit:** TLS 1.2+ everywhere external; internal AWS hops TLS via ALB; HSTS preload.
- **At rest:** provider-level AES-256 (Supabase, S3, Upstash) — table stakes.
- **Field-level (the real control):** `item_secrets` values encrypted client-of-DB with AES-256-GCM data keys, envelope-encrypted by AWS KMS CMK (ADR-007). Decryption only in a narrow web-runtime module, audited per reveal (`audit_log: secret.revealed`), never in worker/AI runtimes — the AI pipeline is architecturally *unable* to read passport numbers (redaction layer is the belt; key isolation is the braces).
- Key rotation: KMS annual automatic; data-key re-wrap job; `key_version` column enables lazy re-encryption.

## 4. Application security

- CSP: `script-src` is nonce-based with no `unsafe-inline` — a fresh 128-bit nonce per request, minted in middleware and carried by both our inline theme script and the App Router's own streamed payload scripts (ADR-010, implemented). `style-src` still permits `unsafe-inline` (Tailwind/React inline styles) and Trusted Types is **not** implemented; both are named here rather than folded into the line above, because this section was previously cited as satisfied while the shipped header read `script-src 'self' 'unsafe-inline'`. All state-changing routes same-site-cookie + custom-header checked (CSRF).
- SSRF: outbound fetches in workers go through a URL validator (deny private ranges/metadata IPs); the pipeline fetches only from our own storage.
- File handling: parse in worker sandbox only; serve originals exclusively via signed URLs with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (stored XSS via SVG/HTML uploads is blocked by the allowlist anyway).
- Dependency policy: renovate weekly, security patches within 72 h SLA, majors monthly batch.

## 5. Secrets-grade PII handling rules

1. Identifier-grade values (SSN, passport #, account #, plate, policy #) live **only** in `item_secrets` — never in `attrs`, logs, prompts, analytics, or search indexes.
2. Extraction detecting such a value writes it to `item_secrets` via a dedicated internal endpoint and replaces it with `{field, last4}` in `extracted`.
3. UI shows `••••1234` + explicit "reveal" (re-auth if session > 15 min old; always audited).

## 6. Detection & response

- Sentry + WAF events + auth anomalies (impossible travel, credential-stuffing patterns from Supabase auth logs) → alert channel.
- Audit log is append-only and queryable — the incident-response primary source.
- IR runbook (pre-written): severity ladder, comms templates, breach-notification clock (doc 13 §8), evidence preservation. Tabletop exercise before launch.

## 7. Rate limiting & abuse

Upstash sliding-window: per-IP (anon), per-user, per-household; stricter buckets on auth, uploads, chat, task-runs. Failure mode: fail-closed for anonymous, fail-open ≤ 60 s for authenticated (availability over strictness for signed-in users; the AI budget is the backstop against cost abuse).

## 8. Human-layer security

Support impersonation requires user-granted, time-boxed consent (product feature, not a backdoor). Founder laptops: disk encryption, password manager, hardware keys for GitHub/AWS/Doppler/Supabase. Phishing-resistant MFA on every admin surface.

## 9. Deferred hardenings (tracked, not forgotten)

Egress domain allowlist proxy for workers; SIEM once there's a security hire; bug-bounty (private) post-launch; SOC 2 Type I engagement at ~20k users (doc 13 §9); pen test before public launch — budgeted, external.
