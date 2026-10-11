# Functional assessment: typed reasoning is not F7 extraction

The proposed typed projection is **not a functional F7 extraction architecture**.
Do not ask the owner to approve it as though it unlocks document extraction.
The existing PR13 remains useful disabled execution/security groundwork; this
assessment does not change its code, publication or approval scope.

## What the model would actually receive

The trusted local stage must already supply document type, semantic field roles,
parsed date/money/state values and ordinal source references. The response contract
can only select those references for known roles and return review statuses. It
cannot discover a type from document evidence, read a new value, create a title,
identify a party or cite a previously unrecognized region. Status validation already
determines missing/supported/conflicting from the complete local candidate set and
checks date ordering. There is no demonstrated model advantage over these rules.
An LLM could guess external context, but that would not be source-backed extraction.

The loss is structural: two documents with the same dates/amounts/state but different
people, issuers, items or contract terms have identical typed projections. The model
cannot distinguish their omitted facts, regardless of model quality or prompting.
Likewise, a supplied `docType` is a local classification result, not evidence that
the provider classified an unseen document. A “hard” model route cannot recover
information that was never provided.

## Eight-type completeness check

The following are functional gaps and examples of information needed by the
intended ledger/review flow, **not a claim that a complete approved per-type field
schema already exists**. PRD F7 freezes the eight types and acceptance behavior;
doc05§4 explicitly gives the insurance field example, while doc02 defines item,
member, vendor and secret relationships. Full extraction schemas remain unfinished.

| Type | Already-local facts in draft | Missing functional work; impossible for this model input |
| --- | --- | --- |
| government_id | Issue/expiry dates, supplied type | Distinguish passport/license and issuing jurisdiction; identify holder/member; locally capture identifier under write-only custody; establish which item this document updates |
| insurance_policy | Effective/expiry/payment dates, premium | Carrier, coverage lines and insured members (explicit doc05 example); policy number custody; covered item/member and renewal terms |
| medical_bill | Service/statement/due dates, due/credit amounts | Determine bill versus EOB/receipt and patient responsibility; patient/provider/item association; distinguish a charge from actual amount owed; account/member identifier custody |
| vehicle_registration | Issue/expiry dates, renewal amount | Vehicle/owner/jurisdiction association; registration/plate/VIN custody; distinguish renewal notice from completed registration |
| lease | Start/end/payment/deposit dates and amounts | Parties/property association, rent frequency, deposit-return conditions, cancellation/renewal terms; a deposit amount alone does not establish a currently due refund |
| utility_bill | Period/due dates, due/credit amounts | Utility/vendor and service/account association, payment/credit context, recurring versus one-off amounts; account identifier custody |
| warranty | Purchase/expiry/claim dates, refund amount | Covered product/warrantor, eligibility and exclusions, claim procedure/conditions, explicit versus duration-derived expiry; no inferred entitlement from a date alone |
| subscription_receipt | Purchase/renewal/cancel dates, paid/refund amounts | Merchant/product, billing frequency, renewal/cancellation/refund terms, paid receipt versus upcoming liability; account/customer identifier custody |

Document-state enums help only if a trusted local stage already establishes their
meaning from complete source context. The current public-notice parser establishes
none of the above eight-type semantics. The 48 draft PDFs do not change its accepted
grammar or constitute approved extraction evaluation evidence.

Cross-cutting omissions: unknown-type generic title/date/parties/amount extraction
(doc04§5.1), per-field confidence calibration, member/item linking, useful proposed
diffs, general visual source regions, corrections-to-corpus, quarantine reasons,
full capture-format support and the required quality gates. Date/amount enums and
contract validation do not discharge these. Manual entry (F8) and staff review
(F17) are valuable fallbacks, not proof of F7 machine extraction or a waiver of it.

## Actual policy and the minimal useful next architecture

ADR018 prohibits all new provider fields under the current approval, including
names and addresses even though ADR007 does not universally classify them as
identifier-grade. It authorizes local parsing/redaction and synthetic verification.
It does not require outsourcing extraction to a provider or forbid trusted local
semantic processing inside the isolation boundary. Doc05§3 supersedes the old
raw-vision path in doc04. The original raw image cannot be sent first and redacted
by the model afterward.

Proceed locally with a **real source-to-candidate vertical slice**, rather than a
paid typed-field demonstration:

1. Specify versioned extraction results for the eight types plus generic unknown;
   distinguish required reviewed fields, unsupported fields and custody-only values.
   Include item/member/vendor linkage evidence, owed-by/owed-to distinctions and
   missing/conflicting/ambiguous states. Keep final values/source maps local.
2. Build and measure a capability-free isolated parser/OCR/semantic extraction
   stage for explicitly selected complete formats. It needs meaningful source
   context locally, including layout and labels; no external transmission or
   credentials. Choose rule/template extraction versus local model-assisted
   extraction based on actual coverage evidence and runtime/isolation costs.
   That engine choice needs technical design review; no new engine is claimed here.
3. Perform deterministic validation, local association and source mapping; route
   uncertainty to review. Identifier values flow only through a separately reviewed
   write-only custody handoff, with no decrypt grant or raw-content logs. Malware
   scanning, complete region accounting, deletion fences and tenant leases remain
   independent gates. Unsupported format remains visibly unsupported.
4. Demonstrate one genuinely useful synthetic document-to-proposal flow first,
   then measure all eight types and unknowns across required capture formats.
   Evaluate classification and extraction from source bytes, never from supplied
   ground-truth types/roles. Keep evaluation labels independent. A local mock test
   or synthetic-only implementation requires no additional owner approval.

Under an unchanged external-egress policy, extraction must be done locally.
OpenAI can remain disabled; inserting it after complete local extraction adds cost
without demonstrated benefit. This preserves privacy constraints but shifts effort
and compute into the local extraction tier; it does not make F7 easy or complete.
The PRD's provider-route implementation details would need reconciliation if local
extraction becomes the chosen architecture, while F7 outcomes remain required.

## The real owner tradeoff

**Recommendation now:** continue the authorized local source-to-candidate work and
complete field/format coverage before requesting any provider data approval. Do
not spend the proposed pilot budget on reclassifying pre-labelled enum payloads.

If the owner specifically wants OpenAI to perform semantic document extraction,
a useful future projection must preserve source semantics the current typed input
removes: e.g. independently verified identifier-free label/value text and layout,
with local opaque entity substitutions and local source maps. That is **not yet a
safe or approved design**. Whole-document redaction, re-identification/leakage and
prompt-injection tests must establish exactly which context can leave; merely
replacing names/numbers is insufficient. Identifiers must remain prohibited.
Names, parties and identifier custody can remain local even in such a design.
Any proposal must state disclosure, format coverage and expected functional gain.

The actual choice is local extraction under unchanged external restrictions versus
a separately reviewed, evidence-backed semantic-context egress amendment for useful
provider extraction. A permanent manual-only/reduced-coverage launch is a distinct
PRD amendment, not an implicit consequence of privacy gates. Synthetic local
prototyping is already authorized; actual provider transmission, paid pilots and
future real customer-data activation are separate approvals.

References: FOUNDING_PRINCIPLES §§6–7; PRD-v1 §§8/F4/F7/F8/F9/F17,13,19–20;
ADR007; ADR018; architecture02 §§3–5; architecture04 §5.1 (subject to ADR018 and
current OpenAI route decision); architecture05 §§3–4.
