# Offline semantic redaction review package

Status: local synthetic experiment, unpublished. No ADR018 amendment, live gateway,
transport, provider call, credential, payment or new application caller. OpenAI
remains selected; neither candidate model was evaluated. The decision on keeping
wording local versus permitting reviewed contextual egress is still pending.

## Reviewable pieces and invocation

- `redaction_review.py`: bounded complete synthetic context grammar and local
  serialization/mapping checks. Imports only the existing local PDF grammar and
  standard-library parsing/hash/weak-reference utilities; no ambient I/O.
- `test_redaction_review.py`: 16 adversarial/metamorphic test methods; source PDFs
  generated entirely from invented inputs, no label JSON/real documents.
- Existing source-candidate tests remain in the same suite: 41 methods total.
- Run `python3 -m unittest discover -s scripts/local-extraction-prototype -v`.

The package admits eight explicitly defined statement grammars within one exact
ASCII text-PDF layout. Complete reconstruction verifies structural PDF bytes;
every parsed text line has a retained/substituted/excluded disposition. Unknown
lines, identity channels, layout/metadata changes, non-ASCII, attachments or controls
refuse the entire context. This is a whole-grammar check, not a claim that a regex
can redact arbitrary PDF/OCR. The fictional marker is a grammar identifier, not
proof that input was actually synthetic. All executed tests use invented input.

Only one person and organization slot are supported, locally substituted with
fixed role placeholders that are reset for each request. Their mappings are
separate local records bound to a household/document/attempt tuple and exact source
hash; the tuple/hash never appears in serialized context. Handles are process-local
and unforgeable by serialization. Caller-supplied scopes are not authenticated
household authority or RLS. Weak references are not a durable retention/deletion
implementation. No names/identifier values enter real custody or persistence.

The only serialized blocks are a substituted relationship line and a fully matched
semantic statement. The local line-disposition evidence binds original byte ranges;
this is not a general token-to-glyph source map for multi-page or reflowed text.
Identifiers/indirect identifiers in known dedicated fields are removed in full,
including their labels. Unknown channels fail closed. Known private value or last-
four collisions with retained statement text refuse even when that creates a false
positive (including a person named May coinciding with the month). Short known
values are not exempt. A balance-due statement is classified neutrally even when
its amount is zero; it does not assert that payment is owed. Arbitrary values embedded under misleading labels are not proven safe.

## What the tests actually establish

| Case | Exercised outcome | Limit |
| --- | --- | --- |
| Direct canaries | SSN/passport/license/plate/VIN/policy/member/account/routing/card/credential/last-four values absent from serialized allowed cases | Known dedicated fields only; no real identifier-detection recall claim |
| Indirect identifiers | Birth date, address/postcode, phone/email, employer and medical details removed; identifying organization replaced | Remaining amounts/dates/conditions still sensitive and potentially linkable |
| Identity substitutions | Changing person/organization/account yields identical context | Does not prove anonymity across different semantic content |
| Cross-tenant/document/attempt | Wrong local binding, source swap or forged handle refuses; identical placeholder spelling resolves only in its original context | Local identity binding only, not authentication, database isolation or reusable external tokens |
| Negation/conditions | Exact retained statements differ for bill/EOB, paid/payable, conditional/due refund, duration/expiry | Deterministic comparator only; no model usefulness/accuracy measurement or new obligations |
| Injection | Commands in identity slots become inert substituted data; unknown instructions/notes refuse without echo/execution | No claim a hosted model would ignore an admitted malicious prompt; source grammar excludes it |
| Hidden/unsupported content | Altered font/layout/pages, metadata, attachments, non-ASCII, duplicate/unknown fields and unparsed lines refuse | One canonical layout only; no OCR or arbitrary-document coverage |
| Limitation witness | Identifier-like digits can pass as a syntactically valid amount when no known sensitive field exposes the collision | This explicitly blocks a general-redaction or activation claim |

A reference reader checks exact JSON shape/slots, refuses duplicate keys, extras,
unknown grammar and coercion, and returns source-observation categories with
mandatory human review. It has no provider transport, tools or domain-write path.
It recognizes a future cancellation as a notice, not current effective coverage;
a warranty duration stays a duration; conditional deposit text creates no due date.

## Explicit readiness outcome

This package is suitable for reviewing **specific information loss and leakage
failure modes**, not approving general semantic egress. Forty-one passing test methods
are not an eval corpus, a measured model score, safe redaction rate or F7 completion.
No acceptance threshold or policy is weakened. Current ADR018 provider payload
remains fixed enums and live calls remain disabled.

Meaningful next design depends on the owner's architecture/privacy choice:

1. If document wording must remain local, retain the useful local validation/
   reference tests and invest in local semantic extraction and review coverage.
   Do not add a hosted-model step that merely repeats extracted fields.
2. If reviewed context may go to OpenAI, prepare a concrete ADR018 amendment and
   supported-format/redaction design using these failure cases. It must define
   residual disclosure, complete region coverage, trusted semantic role evidence,
   placeholder/source transforms, retention/DPA settings and independent evidence.
   This experiment does not authorize transmission; any synthetic provider pilot
   needs separate bounded spend/transmission approval, and real-data activation
   remains separately gated.

Product rules are still restricted to printed observations: renewal/grace windows,
deposit eligibility/return triggers, warranty lifetime/duration computations and
subscription recurrence/cancel/refund semantics remain unresolved. No additional
outbound format, service integration or generic prototype is justified before the
owner's choice. PR13 and its deployed head remain untouched.
