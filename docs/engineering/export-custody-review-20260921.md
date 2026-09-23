# Custody/export compatibility review — local, September 21, 2026

ADR-021 adds **document-work category v1** to current partial snapshot v2. This is
an additive, closed category; historical authenticated v1/v2 artifacts are read
without rewriting their bytes or inventing missing fields. A missing historical
category is explicitly listed as `document-work-state` in omissions. Current snapshot
writers require the category. It includes document UUID, closed custody/work states,
review timestamp, period and charge timestamp. It excludes filesystem/object IDs,
hashes, lease capabilities, provider references, signed URLs and content.

All current categories are selected in one household-scoped PostgreSQL statement.
Overflow refuses rather than truncating. The local encrypted JSONL artifact remains
partial: originals, identifier reveal, free text/attributes/extracted content, full
audit, provider records and ZIP are still omitted. A current `documentWork` category
does not make the old entitlement counter authoritative; processing journals are the
new local accounting source, and the legacy field is preserved historical data.

## Original-document and identifier policy before full export

A complete F15 export must eventually include the owner's retained originals and
identifier data through a separately reviewed reveal/export path. The scanner/model
runtime must not gain decryption authority to produce that export. Request admission
requires live owner binding, recent verified authentication/MFA, CSRF and rate limiting;
export/reveal authority expires, is revocable and must recheck the deletion fence.
Original objects require exact immutable custody/hash binding and a streaming bounded
copy outside tenant transactions, followed by verified artifact publication. A database
row or successful unlink cannot establish byte existence or absence.

Never insert original filenames, content or revealed identifiers into archive paths,
logs, model prompts, queue payloads, audit metadata or error telemetry. Archive members
need server-generated names and an explicit category manifest with counts/hashes,
per-category schema versions and omissions. A corrupt/missing/binding-changed original
must refuse complete publication, not silently omit it. Downloads require current
owner/recent-auth/revocation checks; no public URL, cache, analytics capture or reusable
capability. ZIP path traversal, decompression, total-byte limits, partial writes and
interrupted download/build semantics need separate tests before activation.

These are review requirements, **not an activated decrypt/storage principal or a
claim that full export is implemented**. Backup/provider retention remains disclosed
separately. No provider storage credentials were read or created for this increment.

## Deletion compatibility

Custody and processing journals are now inventoried as document objects and job
artifacts respectively. Their composite tenant references RESTRICT parent deletion:
the existing deletion path refuses unresolved custody rather than cascades away proof.
Cancellation preserves content and accounting. Independent local absence observation
never claims provider/backup erasure and leaves `finalReceiptIssuable=false`.

The next reviewed erasure adapter must settle started/ambiguous effects; delete the
exact custody object; independently observe absence; commit minimal deletion evidence;
and retire/reconcile the journal without resetting already-consumed monthly allowance.
It must cover both selected custody and crash/orphan quarantine copies. An indefinite
hold is not the final privacy workflow. ADR-019 authority stays unactivated. Its hosted
role separation, retention windows, provider deletion and backup evidence remain gates.

No original bytes or identifier-grade values were exported in this increment. Local
fixtures contain only explicit public synthetic text. This review does not establish
full-stack, hosted, legal-compliance or launch readiness.

## Result-publication continuation review

Originals: approve a future INTERNAL bounded archive builder, never direct original
URLs. Before copy and before publication/download, require current owner, verified
recent authentication (and AAL2 when enrolled), active export request, no deletion
fence, exact document/custody identity/hash and a permitted state. A successful scan
alone does not authorize rendering or revealing a hostile original. Builder has only
read authority for selected immutable objects and write authority for the expiring
export artifact; no DB-wide/decrypt/model capability. Server UUID archive names,
stream/byte/count limits, corruption refusal, cancellation and independent cleanup
are prerequisites. This is a design decision, not an implemented original export.

Identifiers: default OMITTED. An explicit future opt-in must enumerate categories;
require AAL2 plus recent authentication even where ordinary export requires only an
unenrolled owner's recent authentication. Record content-free reveal authorization
and completion audits. The complete-export promise includes user-owned identifiers,
but does not authorize decrypting them in a general export worker. Prefer reviewed
client-bound reveal/write-only substitution into an owner-bound encrypted artifact;
key custody, recovery/accessibility and interrupted-download behavior remain unproven.
No identifier reveal route, full-value export or new decrypt grant is added here.

Result/review journals are internal provenance/accounting evidence; current safe work
states remain represented in documentWork v1, while raw extracted/provenance content
and complete audit remain disclosed omissions. Historical authenticated v1/v2 bytes
remain readable; no category is fabricated. Existing unknown-version refusal remains.

Hosted pending policy still needs one founder product decision covering count/bytes,
customer deadline, warning schedule and the eventual retain/export/delete action.
The local 20-object/500-MiB admission and 35-day hold are explicitly NOT tier policy.
No automatic deletion occurs at that hold. No journal retirement, restore-authority
activation or final deletion receipt follows from this review.
