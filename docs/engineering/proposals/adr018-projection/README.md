# ADR018 field projection and source mapping — design review draft

**Functional review:** this typed contract cannot fulfill F7 extraction; it contains
already extracted and labelled facts. See [functional assessment](functional-assessment.md)
for all eight types and the recommended local source-to-candidate architecture.
Do not seek provider approval for this contract as an extraction solution.

Status: proposed, local synthetic investigation only; no policy amendment or provider
activation. Base reviewed foundation is `4d7b7f8931e1585024a0e4d8d5cf81c5d66f5d52`
(PR13). This directory and its additional tests are a separate change. They are not
imported by the gateway or application. Existing runtime payload remains exactly
`{version:1,task:"classify-public-fixture",kind:"deadline-notice"}`.

## Governing decisions

Founding Principles §6.3 and §7.5/7.7 require hostile-input isolation, identifier
custody and supported provenance. PRD §8/F7 and §19 require eight document types,
field review, click-to-source and evaluation. ADR007 distinguishes identifier-grade
values from other household data, but ADR018 expressly prohibits *any new field*
at the provider boundary. Document pipeline §3 adopts that restriction. Local
parser implementation is authorized; arbitrary text/image transmission is not.
No raw-vision fallback, new credential, provider SDK or real-document test follows.

## What the existing parser can prove

`services/ai/src/canonical-pdf.ts` accepts a byte-exact, one-page ASCII public
notice with one variable, calendar-valid date (years 2020–2099). Reconstruction
accounts for all objects, xref, stream, trailer and EOF. It rejects annotations,
metadata, forms, attachments, compression, alternate renderings and unknown bytes.
`redaction.ts` snapshots bytes, issues process-local opaque single-use handles,
retains hash/date offsets locally and exports only fixed enums. Scan receipt and
redaction handle are independent; neither alone proves household admission.

This recognizes public fixtures; it does not redact arbitrary customer PDFs.
The 48 draft evaluation PDFs use another format and are currently unsupported.
No claim of OCR, handwriting, camera capture, EML, multi-page, arbitrary PDF or
image coverage is made. Expand parsers only per reviewed complete grammar and
adversarial corpus. Partial parse or plausible OCR confidence must refuse egress.

## Concrete proposed contracts

`field-policy.draft.json` lists allowed roles for each of the eight types and
explicit excluded/local-only data. The two Draft 2020-12 JSON Schemas describe a
candidate future typed request and a reference-only response, not accepted runtime
payloads. They are not yet converted to OpenAI's supported schema subset or to
production Pydantic/Zod contracts. No provider schema compatibility claim is made.

The request would export document type plus up to 64 locally parsed, typed facts:
calendar dates, nonnegative USD integer cents or closed document-state enums.
Each gets a contiguous request-local slot 0..N-1, freshly assigned in canonical
role/source order. Slots are not tenant/source identifiers or reusable tokens.
The response selects slots by field, with supported/missing/ambiguous/conflicting
status and mandatory human review. It cannot return new values or source quotes.
The trusted local side resolves values and citations from its immutable map.

This is a narrow candidate, **not the complete eight-type extraction contract**:
issuer/member names, coverage descriptions and associations remain local/manual;
identifier fields have no model representation. Medical diagnosis/service prose
stays local. USD, date-year range and USD1M amount ceiling are conservative draft
limits requiring product review, not silent exclusions from F7. Above-limit,
non-USD, uncertain locale, unknown document or unsupported role enters local review.
Zero dollars and paid/credit/cancelled states do not imply an obligation. Refunds
and deposits represent owed-to candidates, not negative owed-by amounts. The model
must not infer deadlines from laws, a warranty duration or an unsigned lease.
Missing evidence remains missing; multiple disagreeing explicit dates stay conflict.

### Semantic validation beyond JSON Schema

- Parse bounded JSON with duplicate-key rejection, no coercion/non-finite numbers;
  reject unknown properties at every level. Require complete provider response,
  exact approved model/schema/prompt; refusal/tool/incomplete output cannot advance.
- Slots are unique, contiguous and canonical. Roles belong to the selected type;
  date roles require calendar-valid dates; amount roles require integer USD cents.
  Only a locally understood label/context may assign a role. A digit sequence in an
  account-number field must never become money or a date because it fits a type.
- Response type matches the request. Every expected role occurs once. References
  exist in this request and match that role; duplicate references refuse. Supported
  fields have exactly one available candidate/reference; missing fields have no
  available candidate or reference. Conflicting fields cover all candidates for
  that role and at least two distinct locally unequal values. A model cannot hide
  existing evidence or select away a conflict. Ambiguous fields have explicit local
  ambiguity evidence. No model confidence value grants authority.
- Validate effective <= expiry and period/start <= end where both are supported;
  disagreement or uncertainty routes review. A source span proves bytes, not truth,
  legal validity, ownership, due status or obligation eligibility.

The narrow typed design deliberately asks the local parser to recognize fields
before the model sees them. That limits the model's added value. A useful generic
extractor may require richer semantic context. Do not solve this by adding a
`text`, `description` or `other` string: that is a new security/product decision.

## Local source map and custody protocol

The trusted broker owns one immutable snapshot and a map keyed by request-local
slot. Each entry binds source SHA256, parser/policy versions, page, a typed role,
value and an end-exclusive source region. For current canonical ASCII PDFs only,
byte start/end exactly cover the date token and page=1. Do not treat these byte
offsets as visual coordinates for a general PDF. Future renderers need a verified
page/coordinate transform tied to the same snapshot and parser version. Review UI
must refuse stale/mismatched maps; source selection must never fetch a model URL.

A map is bound locally to authenticated household/document/processing identity,
DB-time lease, scan receipt and immutable object version. These bindings must be
obtained from the broker/DB, not accepted as evidence from request JSON. Hold no
network I/O inside a household transaction. Under a short scoped transaction,
check open-account/deletion fences, clean scan binding, current lease and quota;
persist reserved attempt and canonical request identity. Execute outside DB.
Before a result proposal is committed, recheck the same source/version/lease and
fences. Timeout after sending is indeterminate; reconcile durable accounting,
never blindly retry or free its budget. Restart must not erase reservations.

Local map contents are sensitive household data. Do not place them in provider
prompts, ordinary logs, analytics, exception messages, GitHub or cache keys. Retain
only under a reviewed custody/retention record, erase/reconcile with source objects,
and cover artifacts/backups in deletion inventory. Audit each state mutation with
content-free version/transition evidence, not source quotes or identifiers.

Identifier extraction requires a separately reviewed local write-only custody
handoff to `item_secrets`, without a decrypt grant for parser/model workers. Do not
retain last-four in provider payloads. Barcode/MRZ, metadata, OCR uncertainty or
unaccounted content still refuses the entire projection; stripping a suspicious
substring is not proof of whole-document coverage. No secret-store implementation
or grant is part of this proposal.

## Offline verification and its limits

Run the offline schema reference tests with Python and `jsonschema==4.26.0`:
`python3 -m unittest discover -s docs/engineering/proposals/adr018-projection -v`.
This is a separately invoked design check, not part of remote CI or a service dependency.
Run the existing-parser tests with `pnpm --filter @autobureau/ai-boundary test`.

The adjacent schema tests validate positive/hostile draft envelopes and local
semantic/reference rules. AI package adversarial tests exercise the *existing*
parser/capability: changed bytes/hash, forged/serialized capability, sensitive
regions and multiple date inputs must never leak dates/source maps to the mock.
Tests make no network/provider calls. An independent review must still assess the
proposal; passing reference tests is not proof of redaction, a sandbox, custody
integration, authorized egress, real RLS or provider accuracy.

## Review outcome and decisions required

Safe to prepare locally: schemas, source-map reference checks, adversarial fixtures
and fail-closed tests. **Not ready for provider activation or real extraction.**

Synthetic-only local prototypes and mocked tests are already authorized. The next
useful step is source-to-candidate extraction with complete local grammars and
independent functional/leakage evaluation, not an approval request for the typed
projection. The substantive owner tradeoff is local extraction under unchanged
egress restrictions versus a separately reviewed semantic-context projection.
See the functional assessment. Real transmission/data remain separately gated;
approval to publish PR13 does not approve either projection or activation.

Product decision: confirm how the required eight-type fields and US-English capture
formats will be covered when names/issuer context/images remain local. Confirm the
proposed range/currency bounds or keep affected documents in visible local review.
Unknown-type generic extraction is required by F7 but cannot currently use model
free text; record this unresolved implementation requirement rather than silently
waiving it. No permanently manual-only launch is implied.

Before activation: reviewed ADR006 OpenAI routing amendment and ADR018 projection
amendment; isolated parser/engine evidence and write-only custody; reviewed full
schemas and source-coordinate mapping; real restricted-role tenant/lease/outbox
and deletion-fence integration; durable accounting and provider outcome handling;
account entitlement/retention/residency; approved labelled corpus, canaries,
per-field thresholds; separate budget and deployment approval. Runtime stays off.
