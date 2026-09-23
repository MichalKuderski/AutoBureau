# ADR-019 principal-security review — September 20, 2026

Decision: **APPROVE WITH REQUIRED AMENDMENTS**. Review base: clean `f5c24ba`;
last tested implementation `40d0c78`. This is an architecture decision delegated by
the continuation request, not operational activation, durable authority evidence,
provider selection, a deletion receipt or permission to purge journals.

The direction is necessary: a restored database cannot prove its own deletion
history. As written, independence is an assertion about an injected port. A signer
can invent a new higher-sequence digest; a restored runtime can omit subjects; a new
generation has no ordered lineage; no independent revocation registry is consulted.
The existing verifier correctly never enables serving, so these are design gaps,
not evidence that its local reconciliation seam currently exposes restored data.

## Threat analysis and required response

| Threat | Required control and residual limit |
| --- | --- |
| Stale DB predates deletion; attacker holds old valid backup | Independently retained tombstone overrides snapshot. Restore admission never trusts snapshot-local deletion evidence. |
| Malicious DB supplies renamed/omitted IDs or fabricated membership | External enrollment/incarnation registry, exact backup/restore manifest and relationship closure; unknown identities quarantine. Content falsely relabeled inside a malicious backup cannot be cured by signing its ID list. Trusted backup provenance and independent admission are required. |
| Replay of active statement | Fresh durable one-use challenge, current witness/key state, exact inventory/manifest binding, expiry and ordered checkpoint. Signature alone cannot allow serving. |
| Replay of deleted statement | Cannot undo deletion; reject replay anyway to prevent evidence/counter confusion and denial of service through stale inventory. Tombstones remain monotonic. |
| Older checkpoint/root or old valid authority backup | Independent witness rejects rollback, survives app/authority restores; unavailable/latest lineage unknown quarantines. |
| Equivocation | Same-sequence different roots rejected; higher-sequence forks require independently witnessed lineage and complete consistent reads. Current map fixture does not prove this. |
| Signing-key compromise | Signer alone cannot rewrite witness or enrollment. Current-key revocation and retrospective reconciliation; deny-only tombstone persists. Compromise of all control planes remains a trust limit. |
| Runtime or deployment compromise | External serving/egress admission with separate administrator; a library return value is not a security boundary against its caller. No runtime signing/witness/enrollment administration. |
| Backup operator compromise | Cannot write authority/admission/keys. Verify backup identity and dependency closure; quarantine untrusted contents. |
| Authority-writer compromise | Separate monotonic tombstone writer from enrollment/hold/key controls. False tombstones can deny service; writer cannot erase suppression or mint active membership. |
| Authority unavailable | Offline quarantined inspection only. No serving/jobs/egress until complete reconciliation. Availability intentionally loses to deletion safety. |
| Partial restore | Complete affected dependency closure and manifest required. Restoring a member/derived object without its household does not bypass the fence. |
| Multi-region restore/partition | One ordered authority/witness lineage. No independent regional activation or last-write-wins tombstone removal; quorum loss quarantines. |
| Household vs full account | Different typed incarnations; full account deletion includes independently registered households and enrollment freeze. No inference from a stale membership table. |
| Account re-creation | New opaque incarnation; never reuse IDs, clear a tombstone, or join old snapshots by email. Email is not stored by the authority. |
| Record loss | Missing is unknown, never active. Independent replication and restore drills; neither empty table nor valid signature establishes completeness. |
| Key rotation/revocation | Independent registry, purpose/epoch, witnessed predecessor, current revocation check. No static-key fallback or generation reset. |
| Compromise discovered later | Quarantine admissions in uncertain window, revoke signer, rebuild from last independently trusted witness and monotonic tombstones. Do not trust historical signatures merely because they once verified. |

## Protocol review

Ed25519 in Node's standard crypto implementation is suitable for signatures. v1's
domain prefix, strict typed body, explicit version, SPKI hash, typed subjects,
challenge and expiry are useful local controls. Canonicalization is fixed Zod field
projection plus JSON.stringify, not a cross-language canonical standard. It needs
versioned vectors and a standard encoding before another runtime signs it. UUID
generation is an identity, not ordered generation. Sequence/root comparison in an
injected port does not authenticate a root or prevent higher-sequence fork signing.
In-memory nonce/checkpoint fixtures lose state on restart; no cross-host durability
or key rotation/revocation is established. The five-second deadline and post-commit
expiry check correctly deny an ambiguous late result without retrying it.

Operational v2 must bind admission scope and exact restore manifest, independent
enrollment state, ordered epoch lineage, witness receipt and current key registry.
No custom consensus/hash-chain protocol is accepted here. Implementations must
select reviewed primitives and demonstrate adversarial durable recovery. v1 remains
a non-activating test seam; no attempt is made to silently upgrade its wire format.

## Operational separation and retention

| Principal | Allowed | Forbidden |
| --- | --- | --- |
| Application / tenant DB role | Request a separately authenticated privacy operation | Authority administration, checkpoint/key mutation, restore admission |
| Deletion worker | Execute bounded manifested erasure and submit observations | Mark authoritative absence, clear tombstones/holds or grant serving |
| Tombstone writer | Append authenticated irreversible deletion for registered incarnations | Active-state rewrite, enrollment, key/witness administration |
| Enrollment controller | Create fresh account/household incarnation and immutable relationship | Reuse deleted identity; attach restored data by email |
| Restore operator | Read minimum scoped inventory; quarantined restore | Change witness, revoke/issue keys, override admission alone |
| Witness / admission controller | Verify committed lineage, retain tombstones; issue bounded serving admission | Read document content, use payment/model tokens |
| Key / hold administrators | Separately controlled rotation/revocation or documented bounded hold | Ordinary app deployment; unilateral erase of suppression evidence |

A single shared cloud administrator can defeat logical role separation. Hosting must
document the real account/admin/failure boundaries and residual collusion risk before
claiming independence. No provider has been selected. Backup and DR tests must include
authority rollback, key compromise, loss of quorum, missing records and regional
partitions. Hold authority requires independent authenticated creation, reason-class,
scope, expiry/review, audit and explicit clearance; unknown hold state blocks retirement.

Retained opaque IDs/relationships can still be personal data. Store no content,
contact details, hashes of email, provider IDs or secret material. Record only state,
lineage and minimal authorization/audit references. Suppression evidence outlives
restorable copies; it cannot be honestly deleted until those copies and replay paths
are independently retired. This limitation must be visible in privacy receipts and
retention disclosures. Count-only online erasure does not prove third-party/backup
erasure. Journal retirement and final receipt remain disabled.

## Acceptance boundary

The mandatory amendments are now in ADR-019. No operational authority can be built
from the existing in-memory fixture. Hosting, external admission, independent
catalog/witness/key custody and hold lifecycle require a concrete separately reviewed
operational design and authorization. Independent local recovery, export, deletion
reconciliation and provider-contract work can continue without those credentials.
