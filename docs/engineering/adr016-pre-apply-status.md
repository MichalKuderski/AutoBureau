# ADR-016 staging pre-apply evidence

September 12, 2026. **APPLY BLOCKED. No real Terraform plan or AWS resource creation has occurred.** Founder architecture approval is recorded; it is not a substitute for the outstanding proof gates.

| Gate | Status | Evidence or remaining work |
| --- | --- | --- |
| Account and region | Verified read-only | Account `792394000571`; resource region `us-east-2`. Repeat immediately before a real plan/apply. |
| Conflicting resources | Clear at inspection | Named quarantine bucket returned NotFound; no Pellum buckets/roles or OIDC providers existed. Recheck availability before creation. |
| Vercel project and issuer mode | PASS | Exact staging project/team IDs, OIDC enabled, team issuer mode; [metadata](evidence/adr016-vercel-settings-20260912.json). |
| Preview signed claims | PASS for native build issuance | [Signature-verified claims](evidence/adr016-preview-oidc-20260912.json), run 34723153581. Token stayed inside Vercel. |
| Stable-staging signed claims | BLOCKED | Automatic review rejected the staging project's production-hosting-scope build. Explicit clarification requested. No stable alias or separate Production application changed. |
| Exact trust and negative assumption proofs | PENDING | Do not set `federation_verified` until both scopes are verified. Real STS calls and effective-policy verification remain outstanding. |
| Remote state and deployment role | PENDING | Encrypted/access-controlled remote state, lock and bounded deployment authority must precede the application-resource apply. No bootstrap resources created. |
| Exact saved Terraform plan | PENDING | Must contain only approved staging additions, with no delete/replace/unrelated resource/access-key/Supabase-key actions. No real plan saved yet. |
| Bucket safeguards | Source/mocked evidence only | Public block, enforced ownership, TLS, AES256, seven-day quarantine, one-day multipart cleanup, prevent_destroy and force_destroy=false exist in the proposed module. Live read-back remains required. |
| Role/namespace least privilege | Source/mocked evidence only | Exact two role subjects and bucket incoming/sealed namespace; no ListBucket or other-bucket grant. Real policy validation remains required. |
| Capability lifetime | Local regression PASS | The adapter requests temporary credentials and signs with one frozen snapshot; expiry is min(900 seconds, remaining STS lifetime). No deployed adapter configuration enabled. |
| Capability confidentiality | Local regression PASS | Entire signed URLs removed from metadata/free-text error logs, safe errors from the SDK, no-store upload responses. No upload URL is emitted to analytics or outbox events. Runtime provider probes remain required. |
| All synthetic provider probes and cleanup | NOT RUN | Require applied infrastructure and verified effective policies. No real upload fixture exists to clean up. |

After the missing scope proof: validate exact trust, establish the approved state/deployment path, generate and inspect the saved plan, and apply only if every gate passes. Then verify effective policies and run the complete ADR probe matrix, preserving only redacted evidence and removing exact synthetic fixtures.

Intake stays disabled afterward. Scanner, dispatcher, retention/reconciliation, worker isolation, complete processing and safe pre-provider redaction have separate gates. Raw sensitive documents must not reach a model provider. Production remains outside this work.
