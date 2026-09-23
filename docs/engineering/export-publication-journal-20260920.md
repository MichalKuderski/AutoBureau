# Local export publication journal

Local synthetic foundation only. Migration 23 adds one forced-RLS, owner-scoped
journal binding request/owner to immutable ciphertext digest, size, snapshot time
and original request expiry. No plaintext hash, keys, provider tokens or paths.
Ordinary application role can insert approved columns and only transition partial
to revoked. It cannot reset revocation, extend expiry, replace bytes or delete rows.
Invoking SQL enforces active owner, exact outbox intent/TTL and deletion fence;
a database trigger audits mutations. Retention/verifier roles see only id/household.
No new roles, SECURITY DEFINER function or provider-table grants. Lock/size/rollback
notes are in the migration. No hosted migration is authorized or performed.

Publication order: owner/intent admission -> single MVCC snapshot -> encrypted
exclusive pending file -> fsync -> atomic immutable publication -> directory fsync
-> journal commit. Downloads require authenticated ciphertext AND matching live
journal, rechecked after serialization. A crash between publication and journal
commit leaves a non-downloadable file; retry authenticates and journals those exact
bytes rather than replacing the snapshot. Revocation commits the database denial
before the local marker and unlink. Restoration of bytes alone cannot undo it.
This does not protect against a malicious rollback of the entire database: ADR-019
external restore authority remains a separate gate.

Version 2 adds bounded account/profile/household projections, preferences, notification
history without content/provider delivery fields, and an allowlisted own-activity
history without audit metadata. Every table shares one SQL statement snapshot.
Overflow refuses rather than truncates. Old version-1 local synthetic artifacts are
not silently promoted; parsing refuses and a new export request is required.

Pending names now bind household/request/random UUID. The bounded per-request sweep
removes only ciphertext which authenticates under that binding and whose original
TTL has expired. Even a paused old writer cannot subsequently pass expiry admission.
Corrupt, symlinked, foreign, unexpired and legacy unscoped files remain refused/retained.
Cleanup writes scoped intent/observation audits and independently checks path absence.
A bounded scan is not complete global inventory; no backup/media erasure is claimed.

Incomplete: originals, identifier reveal, arbitrary attrs/extracted content, record
free text, unclassified/internal audit, notification text/provider delivery data,
financial records and ZIP packaging. ADR-019 requires separately reviewed access
paths for originals/identifiers rather than widening generic projection/decrypt grants.
No complete-export notification is emitted. No deletion final receipt or destructive
journal retirement. Journal presence after expiry is retained metadata, not artifact
availability; operational expiry invocation/key custody/hold policy remain gated.
