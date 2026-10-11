# OpenAI boundary preparation (local only)

The owner selected OpenAI on October11,2026. Published API IDs `gpt-6-astra` and
`gpt-6.1-sol` were verified against official model pages. Account entitlement and
model quality are untested. ADR006's Claude mapping needs a separate reviewed
amendment; this local TypeScript boundary does not replace the planned Python
service or activate a provider runtime.

`services/ai/src/openai-boundary.ts` composes ADR018's existing single-use provider
capability with an exact source-hash check, a strict Responses request/output
contract and a bounded injected MOCK transport. Only the existing fixed enums can
leave the capability. Dates, hashes, tenant/lease IDs and caller metadata remain
local. There is no network client, SDK, credential/environment access or domain
write. `runLiveOpenAi` always refuses; runtime selection is null and disabled.
Neither application routes nor the original proof harness invoke this module.

The local runner reserves its worst-case mock cost before consuming authority,
limits concurrency to one, bounds explicit server retries and total/attempt time,
retains reservations after failures, and treats timeout/network ambiguity as
terminal. A timed-out runner refuses all further calls, even if a transport ignores
abort. Duplicate household/job keys are rejected even if a caller changes lease or
source. These are process-local guards, NOT durable leases, authorization or RLS.
The trusted broker must independently verify household/open-account/clean-custody/
processing-lease bindings. Existing DB processing/result code remains unchanged.
No date, amount, obligation or review decision can be written from this response.

The schema is intentionally the approved closed-fixture schema, not eight complete
extraction schemas. Strict output refuses free text, extra/duplicate keys, refusal,
incomplete state, tools and model mismatch. This conservative parser may reject
otherwise semantically equivalent escaped JSON; rejection stays in review.

## Required design decision before real extraction

ADR018 and doc05§3 explicitly forbid new provider fields, raw/OCR text, images and
metadata until independent redaction evidence and activation approval. An OpenAI
vendor selection does not specify a new allowed projection. Review the exact
field-by-field projection, supported input formats, local parser/identifier
custody and source-span mapping first. Do not replace the closed-enum capability
with a general string, or persist model output via `publishSyntheticResult`.
Eight schemas, durable provider accounting/idempotency, real transport, trusted
broker admission and reviewed result state transitions remain separate work.
The current code provides reusable local execution controls without pretending
these launch requirements are complete.

## One future bounded pilot decision (not executed)

Provider: OpenAI Responses API. Proposed routine route `gpt-6.1-sol`; optional hard
comparison `gpt-6-astra`. Exact configurable candidates only; no substitution.
Input scope initially remains ADR018 fixed public-fixture enums. A meaningful
48-document extraction pilot additionally requires an explicitly reviewed new
projection and approved labels; the current48 drafts are not admitted by this code.
Proposed ceiling: USD5 total including retries; at most50 Sol requests and5 Astra
requests, concurrency1, no tools/files/background work, `store:false`. Reserve
input/output worst-case costs before each request and require an account-specific
spend limit where available. The mock token ceiling is not a live tokenizer or
billing proof. Account access, retention/ZDR policy and regional pricing must be
verified by the authorized operator through existing secret delivery, with no
credentials in chat. No key creation/persistent access setup is included.

Artifact destination: private release-verification Library report and a private
versioned evaluation-artifact location whose access/retention are approved before
execution. Local preparation/evidence is under
`/workspace/scratch/launch-continuation-20261011/`; do not assume that ephemeral
scratch is durable provider evidence. Retain candidate/source/corpus/prompt/schema/
model identities, per-case results and sanitized usage; no raw private documents,
credentials or incident contacts in GitHub. Publication requires separate approval.

Sources: https://developers.openai.com/api/docs/models/gpt-6-astra,
https://developers.openai.com/api/docs/models/gpt-6.1-sol,
https://developers.openai.com/api/docs/guides/structured-outputs,
https://developers.openai.com/api/docs/guides/your-data.
`store:false` does not itself establish Zero Data Retention.
