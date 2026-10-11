# Selected direction: privacy-first hybrid, external boundary still closed

On October11,2026 the owner delegated the safest/reliable/user-benefiting design
choice. The selected direction is controlled local processing and source-backed
validation first, minimal necessary redacted semantic context to OpenAI only when
policy and evidence permit, and local processing/review when they do not. This is
an architecture direction, **not an ADR018 amendment, paid budget, provider
transmission or real-data activation approval**. PR13 remains unchanged/disabled.

## Functional and privacy decision

Use the local path when it can extract complete supported facts reliably. Avoid
sending them merely to have a model repeat them. OpenAI remains the selected hosted
provider (routine candidate gpt-6.1-sol, hard comparison gpt-6-astra); those route
roles are unmeasured hypotheses. Contextual provider extraction earns its place
only by demonstrated task-specific improvement over a local baseline at acceptable
residual disclosure, accuracy, refusal rate, latency and cost. A stronger model
cannot recover omitted context, and no model is independent ground truth.

Fail closed on uncertain redaction or source binding, not just low model confidence.
The UI should explain a bounded review reason and preserve local source access.
It must not silently discard a document, invent an obligation or hide an unresolved
field. Reliability includes honest coverage and recoverable review, not only fewer
API failures. F7/unknown-type/capture-format and evaluation requirements remain
unwaived; local fallback is not permission for a permanently manual-only launch.

## Assets, adversaries and trust boundaries

Assets: original bytes; household/member associations; identifier-grade values and
custody records; medical/financial/contract facts; local source/entity mappings;
provider budget; review decisions, audit evidence and deletion fences.

Assume uploaded PDFs/images/email are hostile, including a legitimate household's
malicious input. Source text is never an instruction to the broker, parser or model
runtime. A compromised parser can fabricate plausible redaction; a provider can
return plausible unsupported fields. Schema validity and scan cleanliness do not
establish semantic correctness. Insider/tenant confusion and accidental operator
logging are included; the design does not claim to eliminate infrastructure or
account compromise.

Boundaries: intake/quarantine → credential-free isolated scan/parser → trusted
local custody/broker → reviewed projection → tool-less provider → local validator
→ scoped review/persistence/outbox. Original identifiers are never supplied to a
provider for it to redact. No network work occurs inside tenant transactions.
A scanner or parser process holds neither tenant DB/model credentials nor identifier
decrypt authority. Write-only identifier custody is a separate trusted handoff.

## Threats, controls and present evidence

| Threat | Required control / failure behavior | Present evidence and unresolved risk |
| --- | --- | --- |
| Hidden PDF objects, overlays, metadata, OCR gaps | Account for all content channels in named supported formats; refuse unknown/uncertain regions | Exact synthetic text-PDF reconstruction tested; general PDF/images/OCR unproved |
| Split/encoded/unknown identifiers | Complete local identifier/custody policy, adversarial testing; no raw-text fallback | Known field canaries and unsupported-region negatives only; unknown identifier disguised as amount is an explicit counterexample |
| Indirect/re-identifying facts | Remove unnecessary identities/context; explicitly review remaining disclosure | Synthetic DOB/address/contact/employer/diagnosis removal works for known slots; dates/amounts/terms/relationships remain sensitive |
| Prompt injection | Treat source as data, no tools/capabilities, closed source/response schemas, supported citations, quarantine/review unsupported text | Synthetic commands inert in substituted identity slots; unknown instructions refused; no model-injection resilience measurement |
| Tenant/placeholder confusion | Broker-authenticated household/source/attempt bindings and fresh per-request mapping; no global placeholder lookup | Local scope/source collision tests pass; caller Scope is not authentication or RLS |
| Stale source, forged citation, semantic drift | Immutable source hash/version; exact transformation map; response value/support verification | Synthetic line/byte mapping and reparse-before-review tested; arbitrary rendering/token mapping unproved |
| Plausible but wrong due/coverage state | Separate printed fact from product rule; calibrated field thresholds and human review | Cancellation notice != current cancellation; receipt != future charge; zero balance/conditional deposit != payment/due refund; no legal-rule inference |
| Provider timeout, retries and budget amplification | Durable reservations/attempt identity; conservative indeterminate state, no blind retry/refund | PR13 has offline in-process controls only; durable accounting/broker integration remains unfinished |
| Leaking logs/artifacts or undeleted mappings | Content-free operational logs, reviewed retention, deletion inventory/fences and reconciliation | Local test artifacts are synthetic; no live trace/custody/erasure proof |
| Malicious or compromised parser/redactor | Pinned isolated engine, no ambient capabilities, independent leakage/false-refusal evaluation | Python module import checks are not OS isolation or production security proof |

## Evaluated tradeoff, without invented scores

The offline package has 41 passing methods and independent review, covering four
semantic collision pairs and direct/indirect canaries in a closed grammar. This is
functional negative-control evidence, not model evaluation or measured real-world
redaction recall. For these exact statement patterns the deterministic local reader
already recovers the intended categories. The test shows that context is informative,
not that a hosted model is needed or better. The known valid-amount/identifier ambiguity is a reason to keep
activation closed, not a tolerable measured error rate.

| Option | What evidence currently supports | Cost/risk not yet measured | Decision |
| --- | --- | --- | --- |
| Local source extraction/validation | Printed facts and source references work on one synthetic layout; clear negatives refuse | Real-format coverage, broader semantic extraction, CPU/latency, review burden | Continue as baseline and trusted validation tier |
| Hosted reasoning over typed pre-extracted fields | Contract tests; little information beyond local results | No demonstrated accuracy/utility gain, additional cost/disclosure | Do not pilot merely to demonstrate a paid round trip |
| Minimal contextual OpenAI extraction | Synthetic context retains distinctions lost by typed projection | Actual model improvement, full redactor coverage, residual disclosure, latency/cost, false refusals | Chosen conditional extension; stays disabled until separately justified |
| Raw documents/OCR/images to hosted model | Would expose identifiers before redaction | Contradicts current custody/security policy | Rejected; no fallback |

Conservative collision checks intentionally refuse a person named May alongside a
May date, or account digits that coincide with a printed amount. This proves a
specific safeguard can fire; it does not estimate false-refusal rates. Overly broad
redaction can destroy meaning, while relaxed redaction can leak identities. Measure
both against independent labels rather than choosing convenience by intuition.

## Admission gates for a later amendment and pilot

1. Define exact required output fields and source semantics; settle remaining
   renewal/grace/deposit/warranty/subscription policies separately. Printed facts
   can proceed locally; derived obligations cannot borrow authority from a model.
2. Select complete supported input formats and local parser/redactor/custody design.
   Prove all-region accounting, source transforms, isolation and identifier policy
   with independent adversarial cases, including non-identifier-looking identifiers.
3. Propose exact context categories from semantic-context-option.md, minimized per
   task. No category is allowed merely because its type/schema validates. Keep
   unnecessary diagnosis/treatment, original identity and local mappings excluded.
   Default identity documents and identifier-dense/medical contexts to local review
   until their specific necessity and residual-risk evidence are reviewed. Document
   type alone is not a privacy classifier or permission to disclose.
4. Define accepted residual sensitivity and retention/residency/no-training terms;
   complete the reviewed ADR018 amendment and reconcile provider routing documents.
   No automated configuration flag can stand in for these decisions.
5. Before a paid synthetic provider comparison, obtain explicit transmission/budget
   approval, account entitlement/settings and approved synthetic labels. Compare
   local baseline versus exact OpenAI candidates on the same independent cases,
   recording accuracy, missed sensitive canaries, false refusals, review burden,
   latency and cost. Do not fabricate a safe score from this offline harness.
6. Real customer-data activation remains separately gated by complete F7/capture/
   unknown-type evaluations, RLS/custody/deletion/outbox/attempt integration, actual
   review/correction UI, provider/privacy requirements and deployment approval.

There is useful offline implementation and evidence to build under this direction.
There is currently no basis to activate context transmission or claim broad F7
readiness. Preserve the distinctions between architecture choice, policy amendment,
synthetic provider spend and real-data activation in every handoff.
