# Local source-to-candidate prototype

Unpublished offline synthetic work, separate from deployed PR13. OpenAI remains the
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

Supported semantic slice: medical bill and utility bill, one layout, explicit due
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

The 12 files are byte copies of existing synthetic boundary fixtures, not new corpus
coverage. Six scenarios × two types; no approved labels, independent extraction
metrics, OCR, camera formats, layout diversity or eight-type support. Tests use
explicit independent expected values and include changed values in the accepted
grammar, forbidden regions/identifiers, malformed dates/amounts, stale citations,
forged proposals, cross-household/mismatched/ambiguous links and no-ambient-authority
source checks. These are local contract/behavior tests, not sandbox enforcement,
malware/redaction accuracy, F7 completion or authorization to process real content.

All other document types/unknown formats fail closed with a bounded content-free
reason. That is an honest prototype limitation; unknown-type generic extraction
remains a required F7 implementation task. Next useful work is reviewed complete
field contracts, broadened local formats/semantic coverage and real source-backed
review/correction integration under custody/tenant/deletion gates. Do not route
outputs through the existing synthetic result publisher as if they were production
model results. No production parser/guard/schema/application files are changed.
