# Source-backed synthetic review integration

Local, unpublished continuation from PR14 head
`37fd91ac7d2f85a4559b271013de698c0499c135`. No migration, provider activation,
credential, intake configuration, deployment or real-document processing change.

## Requirement and actual behavior

PRD CJ-4, F7 and §19 require inspectable proposed fields and their sources before
review. The existing owner-only result panel exposed accounting status and an
approve/discard decision, but not the date that decision would file. The separate
eight-type Python prototypes cannot be inserted into `document_results`: that
immutable table and its reviewed transitions support one canonical public
synthetic deadline format, not arbitrary extracted facts.

This change integrates the existing supported format into the application:

1. The owner opens the existing document result panel and sees its proposed date.
2. “View source text” reveals the public notice heading and highlighted date beside
   the proposal. The label explicitly says the stored PDF is not opened.
3. The existing apply action rechecks the same canonical source proof and current
   lifecycle before invoking the existing atomic review/accounting transaction.
   Mismatched evidence cannot be filed through this HTTP flow. Expiry between GET
   and POST refuses without charging; source inspection itself performs no write.
4. After filing, the date is labelled filed. Historical filed/count status remains
   true even if source custody expires; unavailable evidence is then withheld.

The proof reconstructs the existing canonical PDF from the result date and compares
its entire SHA256, byte size, page and exact PDF-byte citation. Scoped SQL also
checks document/work/custody/object/scan/attempt, clean verdict, completion and
engine/signature/sandbox identities. Only the fixed public source kind, date and
page are returned. Hashes, raw PDF offsets, storage references, scan internals and
leases remain server-side. Displayed text highlights are separate from raw PDF
byte coordinates. No arbitrary bytes are parsed in a web handler and no I/O is
added inside a database transaction.

The owner/authentication, RLS, deletion fence, custody expiry, capacity, month
rollover, immutable result and exactly-once review/charge paths remain authoritative.
Cached source evidence is cleared on authorization denial and isolated across
household changes using the existing query lifecycle. The same bounded load used by status/apply gains
joins and local hash reconstruction, not additional database transactions.

## Limits that remain

- Hash equality proves canonical source contents, not that the retained object is
  presently retrievable. This is a source-text view, not a PDF renderer or general
  click-to-glyph implementation.
- The lower trusted local `approveSyntheticResult` broker path is unchanged. This
  new shared proof protects the application GET/apply path; it is not a claim that
  all approval entry points gained independent canonical reconstruction.
- No general extraction, correction persistence, rejection-reason capture,
  calibrated confidence, unknown-type extraction or eight-type application schema
  is implemented here. No existing synthetic publisher is repurposed for broader
  Python candidate dictionaries.
- The source hash does not establish legal truth, current obligation eligibility,
  identity, ownership, malware safety or general redaction quality.
- Existing database-only synthetic fixtures do not prove cloud object storage,
  real scanner behavior, full browser E2E or a production lifecycle.

## Remaining production gates

| Area | Evidence now available | Work still required |
| --- | --- | --- |
| Deployed PR14 | Exact reviewed tree, successful CI/build/smoke/hosted acceptance; user-visible sign-in/dashboard/reload confirmation | General product acceptance and production authorization remain separate |
| Hybrid AI direction | Reviewed threat model, disabled OpenAI foundation and offline leakage/usefulness controls | Exact approved contextual projection, independent format/redaction evidence and provider evaluation; no typed-field paid demonstration |
| F7 application | This local source-review integration for one canonical synthetic type | Reviewed complete candidate contracts, authenticated broker/custody integration, real source viewer, corrections/audit/eval linkage, unknown types, eight-type evaluations and thresholds |
| Security/recovery | Scoped transaction and lifecycle controls, synthetic restricted-role regressions | Original KMS provenance artifact comparison; exact pinned scanner proof; complete custody/deletion/restore evidence and independent assurance |
| Providers/operations | Existing bounded plans and disabled integrations | Authorized Stripe TEST/Plaid Sandbox acceptance, production-provider readiness, PITR/object recovery and isolated restore rehearsal, operational and external launch evidence |

Production remains NO-GO. More passing synthetic controls do not close the missing
functional or independent evidence gates. See PRD §19, §21.1–21.3, ADR018 and the
production cutover runbook; no requirement is amended by this report.

## Owner dependencies, without reopening confirmed choices

No owner decision is needed to complete this narrow local integration. Engineering
can next prepare complete immutable candidate/review contracts and custody/source
integration while keeping extraction and egress closed. Derived renewal, grace,
deposit, warranty and subscription rules must be reviewed before they produce
obligations; printed observations alone do not decide those rules.

The remaining external dependencies are:

- Supported access to the original KMS provenance archive and exact pinned scanner
  image, or an authorized executor retaining them. Prior denied/failed transfers
  are not retried through another route and pins are not replaced.
- Review of a concrete minimal-context privacy/policy amendment and, only after
  admission evidence is sufficient, separate bounded synthetic provider-spend
  approval. Provider and architecture choices already made are not reopened.
- Approved test account/runtime scope and cleanup for the prepared Stripe TEST and
  Plaid Sandbox acceptance work; live financial/provider activation is separate.
- Recovery retention/cost approval and isolated restore authority after the final
  account-specific plan is reviewable; database and object recovery are distinct.
- Security/privacy escalation coverage and tested incident access, plus existing
  external security, legal, usability, deliverability and beta-SLO evidence required
  by the launch checklist. Confirmed incident/on-call assignments are not requested
  again; private contacts stay outside the repository.
