# Local source-to-candidate prototype

Draft offline synthetic review package, separate from deployed PR13. OpenAI remains the
selected future provider; this module does not invoke it or mint provider capabilities.
No network/client/DB/filesystem/credential authority exists in `extract.py`. Tests
read only the 12 checked-in original synthetic fixtures; no real documents used.

Run with standard-library Python: `python3 -m unittest discover -s scripts/local-extraction-prototype -v`.

The meaningful change from the typed projection: callers provide **PDF bytes**, not
an expected type, role list or ground-truth values. The parser reconstructs the
complete canonical PDF and derives type/field roles/values from its text. It reads
no annotation JSON. Names remain fixed public synthetic literals, not arbitrary
customer identity. Canonical one-page ASCII PDF syntax is the only supported format;
no parser repair, compression, metadata, JS, attachments, images or OCR is accepted.
Every source byte must match reconstruction before semantic parsing.

Original payment slice: medical bill and utility bill, one layout, explicit due
date and USD amount, missing date, ambiguous date order, two unsuperseded dates,
valid leap day, and explicit paid-zero/credit-only statements. It derives a proposed
owed-by payment only from a supported explicit date and positive amount without
review conflicts; even that proposal requires human review and is never persisted.
Credit alone does not invent a dated owed-to refund. No calendar expiry, recurrence,
legal deadline or entitlement inference exists. An explicit synthetic type heading
makes classification trivial; this is not real-world classification evidence.

Each field retains source hash, raw byte range, page/line and known-layout baseline.
A review display model re-extracts the source before accepting result objects,
refuses stale/forged fields and resolves their citations. Coordinates are baselines
for this one synthetic PDF layout, not general rendered bounding boxes. A local
exact holder/issuer/type match scoped to the supplied synthetic household proposes
an existing member/item; zero or multiple matches stay unresolved/ambiguous.
This is not authenticated tenancy or RLS. The caller supplies synthetic registry
entries; no registry is read or written. Linking is a review suggestion, not identity
verification. Corrected values, audit persistence and actual UI remain unfinished.

The 12 checked-in files are byte copies of existing synthetic boundary fixtures,
not new corpus coverage. New tests construct independent source values for the
remaining six types in the same canonical layout. There are still no approved
labels, independent extraction metrics, OCR, camera formats or layout diversity.
Recognizing eight fixed synthetic headings is not broad eight-type F7 support. Tests use
explicit independent expected values and include changed values in the accepted
grammar, forbidden regions/identifiers, malformed dates/amounts, stale citations,
forged proposals, cross-household/mismatched/ambiguous links and no-ambient-authority
source checks. These are local contract/behavior tests, not sandbox enforcement,
malware/redaction accuracy, F7 completion or authorization to process real content.

All unknown document types/unknown formats fail closed with a bounded content-free
reason. That is an honest prototype limitation; unknown-type generic extraction
remains a required F7 implementation task. Next useful work is reviewed complete
field contracts, broadened local formats/semantic coverage and real source-backed
review/correction integration under custody/tenant/deletion gates. Do not route
outputs through the existing synthetic result publisher as if they were production
model results. No production parser/guard/schema/application files are changed.


## Six-type source-observation continuation

The remaining six types now have narrowly defined printed-fact observations. These
are local prototype field names, not approved complete production extraction
schemas. The parser derives values from PDF text; it never reads label JSON, a
scenario filename, expected normalized values or a caller-supplied type. Exact
synthetic headings identify type, so classification difficulty remains trivial.
Dates generalize within the accepted grammar; all source references remain bound
to the immutable byte snapshot and review reparses before trusting result objects.

| Type | Supported source facts | Explicit stop at unresolved product semantics |
| --- | --- | --- |
| Government ID | Printed expiration date; missing/invalid/ambiguous/conflicting date | Which ID subtype/jurisdiction, renewal lead time, action window and member/identifier custody |
| Insurance | Printed coverage end; explicit cancellation notice/date, no replacement end | Cancellation versus a future renewal and coverage/insured-item semantics; no automatic active coverage or premium obligation |
| Vehicle registration | Printed registration expiration | Jurisdiction-specific renewal/grace rules, vehicle identity/ownership and registration custody |
| Lease | Printed end or explicit start/end pair; reversed range flagged | Deposit eligibility/return trigger, notice/renewal rules and rent cadence; end date is not automatically a deposit due date |
| Warranty | Printed end; literal lifetime-limited statement with no calendar expiry | Whose lifetime, exclusions/claim eligibility, duration-based date arithmetic and claim/notice windows |
| Subscription receipt | Printed payment-received date or paid amount; explicit missing renewal | Billing cadence, next charge, cancellation/refund conditions; receipt date is never relabelled as renewal/payment due |

All six return no payment/renewal/entitlement obligation candidate. Observed dates
remain evidence, not legal/product-policy determinations. A cancellation notice is not a current effective coverage state; no wall-clock
state is inferred from its printed future/past date. No missing date is
invented; unsuperseded dates remain unresolved and invalid/missing evidence is not
misclassified as two conflicting valid dates. Review reasons distinguish cancellation,
reversed lease range, undefined lifetime and receipt-without-renewal.

Tests cover independent date/amount values, leap/invalid dates, conflicting and
mixed statements, unsupported policy/identifier lines, cross-source references and
per-type household link suggestions. This extends the local validation slice, not
real-world capture coverage, arbitrary semantic extraction, UI correction storage,
authenticated tenancy, egress authority or F7 completion. Product/technical review
must settle the above policy mappings before obligations are implemented; the
prototype does not choose them silently.
