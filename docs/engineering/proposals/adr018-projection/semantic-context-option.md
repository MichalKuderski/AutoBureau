# Semantic context for useful OpenAI extraction — amendment option, not authority

Status: design option only. ADR018 currently permits no new provider fields.
No transmission/paid test/live adapter follows from this document. Local synthetic
prototyping remains already authorized. OpenAI (`gpt-6.1-sol`, `gpt-6-astra`) remains
the selected provider; we are not substituting another hosted provider or a new
local-model commitment.

## Necessary information, shown with invented examples

A useful extractor needs relationships between labels, values and surrounding terms,
not only already-extracted facts. Proposed local redactor output might preserve:

```
block 0: Statement for [PERSON_1], issued by [ORG_1].
block 1: THIS IS NOT A BILL. Your provider may bill you separately.
block 2: Service charge: USD 125.00. Your responsibility: USD 0.00.
```

Contrast another source with the same charge:

```
block 0: Bill for [PERSON_1], issued by [ORG_1].
block 1: Balance due: USD 125.00. Payment due: February 15, 2028.
```

These distinguish an EOB-like statement from a payable bill without revealing the
person or issuer identity. The model must cite the supplied block(s); a charge alone
cannot become a payment obligation. The document type is an output, not a caller's
ground-truth input. These are design examples, not predictions or measured accuracy.

For an owed-to example, `Security deposit: USD 1800.00. Refund subject to inspection
and deductions; return date not specified.` supports a conditional entitlement
candidate, not an invented due date. For a warranty, `Coverage lasts 24 months from
purchase; excludes accidental damage` supplies a duration and condition missing
from a date/amount enum. Locally verified purchase evidence and reviewed date-rule
semantics are still needed before any derived expiry; the model cannot invent them.

## Precise candidate outbound categories

Only after an explicit amendment and demonstrated complete local redaction:

- Bounded document-derived, identifier-free semantic text: headings/labels, field
  values, negations, payment/coverage/refund/cancellation conditions and units. This
  is new text egress, not the existing closed-enum policy in another name.
- Printed dates, currency and amounts, durations and recurrence expressions where
  locally verified to be semantic content rather than identifier strings.
- Minimal reading-order/table relationships: request-local block/cell ordinals and
  adjacency, preserving which label qualifies which value. Exact PDF coordinates,
  fonts, files and original layout metadata remain local.
- Fresh per-request entity placeholders such as `[PERSON_1]`, `[ORG_1]`,
  `[PRODUCT_1]`, `[ADDRESS_1]`. Their mapping stays local, never reusable across
  requests. Preserve coreference only when locally established; uncertain mappings
  must refuse or route review. Placeholder syntax is not a security proof.

The payload does not need holder/issuer names to recognize roles or bill context.
Vendor/member/item matching and restoring local display values happen on the
trusted side. Product/coverage semantic classes may remain useful but can reveal
sensitive facts; exact product identity should be locally substituted until a
separate need and policy are established. Generic unknown-type title generation
must be based on admitted text and placeholders, then safely reconstructed locally.

Candidate response: document classification, typed proposed fields or missing/
ambiguous/conflicting states, cited block/cell references and source spans, plus
mandatory review until evaluated field thresholds exist. Refuse fabricated values,
unknown references, identifier fields, tool calls, free-form explanations and
unsupported derived deadlines. Local parser/source mapping verifies that cited
context supports each value. A quote match alone does not prove semantic support.
Use a versioned grammar/schema; the earlier draft schemas are not this contract.

## Residual sensitivity and prohibited content

Even correctly redacted text can disclose that someone has a medical bill, policy,
lease or product; amounts/dates/conditions and rare combinations can re-identify.
Placeholder count/coreference and table structure reveal relationships. Removing
names is not anonymization, and an all-clear classifier cannot establish zero risk.
The owner/privacy reviewer must explicitly accept the remaining disclosure scope,
provider retention/residency and contractual restrictions before transmission.
No training on household data; `store:false` alone does not establish that policy.

Always excluded: SSN/tax/passport/license/plate/VIN/policy/member/account/routing/card
numbers, credentials/tokens, signatures, biometrics, MRZ/barcodes and last-four;
source bytes/images/raw OCR dumps; original names/addresses and unrestricted issuer
or product identity; filenames, paths, URLs/contact details, hidden metadata,
source hashes, tenant/document/member IDs, local secret handles, custody receipts
and mapping tables. Diagnosis/treatment details are unnecessary to the minimal
bill-payment slice and excluded. Unknown identifier/medical subfields, unparsed
regions or uncertain redaction fail the complete projection, not just that span.

No generic `text` escape hatch may pass arbitrary parser output. Every outbound
region needs a known policy disposition; compressed/embedded/hidden/overlay/mixed
scripts, OCR ambiguity and alternate renderings require measured coverage or
refusal. Split/encoded identifiers, prompt instructions and identifier-looking
amounts/dates require adversarial tests. A local text allowlist/regex by itself does
not prove coverage. No model may be asked to redact the raw original first.

## Source mapping and local proof before any provider pilot

Record immutable source hash + parser/redactor/policy versions locally. Every
emitted token range maps to original region(s), with a typed disposition (retained,
substituted or excluded) and local integrity checks. Verify full document coverage,
non-overlap/defined transforms and deterministic reconstruction. Refuse a response
if its block/span references were removed, replaced inconsistently or came from a
stale source. Excluded regions never become implicit model evidence.

Use synthetic counterexamples that collide under the old typed projection but
require different proposals: bill versus EOB; paid versus payable; conditional
versus due deposit; warranty duration versus printed expiry; cancelled versus
active coverage; conflicting dates with/without explicit supersession. Change
names/account canaries without changing allowed semantics and check that outputs
and serialized outbound payloads reveal no identity. Measure redactor recall and
false refusals across formats independently from extractor quality. Mocked tests
prove serialization/rules only; they cannot establish model quality or safe
real-document redaction. Do not pay to demonstrate a redundant typed reducer.

## Explicit choice, after useful local evidence

Option A retains current external restrictions and performs source semantics,
linking and candidate creation locally, with measured format coverage and review.
This shifts capability/compute burden locally and may require architecture-route
reconciliation, but does not relax privacy or F7 outcomes.

Option B amends ADR018 to permit the narrowly specified semantic projection above
for named formats after independent leakage/custody evidence. This creates a real
OpenAI extraction task but also new sensitive-data disclosure. Before asking for
that decision, provide actual local redactor coverage results, usefulness cases and
precise unknowns; do not describe the proposal as already safe or complete.

A synthetic *local* prototype requires no new approval. Actual provider transmission
of an approved synthetic projection and its bounded cost require separate consent.
Real customer-data transmission requires additional explicit activation approval,
retention/DPA/account settings, tenant/custody/deletion integration and release gates.
Approving PR13 or a synthetic pilot never authorizes that real-data step.
