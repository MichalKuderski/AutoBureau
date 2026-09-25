import { runAsSystem } from "./audit.js";
import type { Database } from "./scoped.js";
type LocalComponent = "documents" | "derived-records" | "identifier-secrets" | "notifications-reminders";
export type LocalErasureClaims = Readonly<Record<LocalComponent, Readonly<{ id: string; token: string; operationId: string }>>>;
/** Local-only bounded online erasure. Never interprets acknowledgements as absence.
 * The restricted retention role and DB trigger independently require a mature,
 * settled fence and matching manifest. No ciphertext or source content is selected.
 * Deliberate child-first ordering prevents accidental FK cascade content erasure.
 * Providers, identity, audit and durable replay/fence evidence remain uncompleted. */
export async function eraseLocalDocumentBatch(db: Database, householdId: string, requestId: string, claims: LocalErasureClaims) {
  return runAsSystem("Erase bounded manifested local document resources", () => db.withHousehold(householdId, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${householdId}`},0))`;
    const request = await tx.householdDeletion.findFirst({ where: { id: requestId, householdId, state: "verifying" }, select: { id: true } });
    if (!request) throw new Error("Local erasure refused");
    // One bounded leaf-table batch per invocation. Later parents are considered only
    // after child batches are empty, so the row bound is not multiplied by cascades.
    const stages = [
      () => tx.$executeRaw`DELETE FROM notification_deliveries WHERE id IN (SELECT x.id FROM notification_deliveries x JOIN notifications n ON n.id=x.notification_id WHERE n.household_id=${householdId}::uuid ORDER BY x.id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM reminders WHERE id IN (SELECT id FROM reminders WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM item_secrets WHERE id IN (SELECT s.id FROM item_secrets s JOIN items i ON i.id=s.item_id WHERE i.household_id=${householdId}::uuid ORDER BY s.id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM obligations WHERE id IN (SELECT id FROM obligations WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM items WHERE id IN (SELECT id FROM items WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM document_chunks WHERE id IN (SELECT id FROM document_chunks WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM document_uploads WHERE document_id IN (SELECT u.document_id FROM document_uploads u JOIN documents d ON d.id=u.document_id WHERE d.household_id=${householdId}::uuid ORDER BY u.document_id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM documents WHERE id IN (SELECT id FROM documents WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
    ];
    const components: readonly LocalComponent[] = ["notifications-reminders", "notifications-reminders", "notifications-reminders",
      "identifier-secrets", "derived-records", "derived-records", "derived-records", "documents", "documents"];
    for (let stage = 0; stage < stages.length; stage++) {
      const claim = claims?.[components[stage]!];
      if (!claim) throw new Error("Local erasure lease required");
      // Lease ownership is checked and held in the SAME transaction as each batch.
      // The trigger independently binds this capability to the affected component.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deletion-resource:${claim.operationId}`},0))`;
      const [attempt] = await tx.$queryRaw<Array<{ id: string }>>`SELECT a.id FROM deletion_attempts a
        JOIN deletion_resources r ON r.id=a.resource_id WHERE a.id=${claim.id}::uuid AND a.household_id=${householdId}::uuid
        AND r.household_id=${householdId}::uuid AND r.deletion_id=${requestId}::uuid AND r.id=${claim.operationId}::uuid
        AND r.component=${components[stage]} AND a.lease_token=${claim.token}::uuid
        AND a.lease_until>clock_timestamp() AND a.completed_at IS NULL FOR UPDATE OF a`;
      if (!attempt) throw new Error("Local erasure lease refused");
      await tx.$executeRaw`SELECT set_config('request.erasure_attempt',${claim.id},true),set_config('request.erasure_token',${claim.token},true)`;
      const count = await stages[stage]!();
      if (count) {
        // Blind audit insert: retention may write evidence, never read account audit content.
        await tx.$executeRaw`INSERT INTO audit_log(household_id,actor_type,action,target_type,target_id,meta)
          VALUES(${householdId}::uuid,'system','privacy.local_batch_erased','household_deletion',${requestId}::uuid,
          jsonb_build_object('stage',${stage}::int,'count',${count}::int,'attempt',${claim.id}::uuid,'resource',${claim.operationId}::uuid))`;
        return { stage, count, onlineRowsDrained: false, finalReceiptIssuable: false as const };
      }
    }
    return { stage: stages.length, count: 0, onlineRowsDrained: true, finalReceiptIssuable: false as const };
  }));
}
/** The only content a minimized household anchor carries (ADR-019 amendment). */
export const HOUSEHOLD_ANCHOR_NAME = "Deleted household";
/** Household-record stage (component 'account-household'): idempotency records, household
 * members and entitlements, one bounded batch per call. Runs only after derived records
 * are gone, so member FKs never cascade into records this worker may not update. The
 * household row, memberships, account identity and protected journals stay: they are
 * ADR-019 suppression evidence, not erasable by this worker, and never a final receipt.
 * Once the records are gone the anchor is minimized: its name becomes the fixed placeholder
 * and its alias is cleared, written blind (the worker cannot read what it replaces). */
export async function eraseLocalHouseholdRecordsBatch(db: Database, householdId: string, requestId: string,
  claim: Readonly<{ id: string; token: string; operationId: string }>) {
  return runAsSystem("Erase bounded manifested household records", () => db.withHousehold(householdId, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${householdId}`},0))`;
    const request = await tx.householdDeletion.findFirst({ where: { id: requestId, householdId, state: "verifying" }, select: { id: true } });
    if (!request || !claim) throw new Error("Local erasure refused");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deletion-resource:${claim.operationId}`},0))`;
    const [attempt] = await tx.$queryRaw<Array<{ id: string }>>`SELECT a.id FROM deletion_attempts a
      JOIN deletion_resources r ON r.id=a.resource_id WHERE a.id=${claim.id}::uuid AND a.household_id=${householdId}::uuid
      AND r.household_id=${householdId}::uuid AND r.deletion_id=${requestId}::uuid AND r.id=${claim.operationId}::uuid
      AND r.component='account-household' AND a.lease_token=${claim.token}::uuid
      AND a.lease_until>clock_timestamp() AND a.completed_at IS NULL FOR UPDATE OF a`;
    if (!attempt) throw new Error("Local erasure lease refused");
    // Derived records reference members (ON DELETE SET NULL). Refuse rather than let a
    // cascade try to rewrite rows this worker has no authority to update.
    const [derived] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT (SELECT count(*) FROM items WHERE household_id=${householdId}::uuid)
      +(SELECT count(*) FROM obligations WHERE household_id=${householdId}::uuid) AS n`;
    if (Number(derived!.n) !== 0) throw new Error("Local erasure ordering refused");
    await tx.$executeRaw`SELECT set_config('request.erasure_attempt',${claim.id},true),set_config('request.erasure_token',${claim.token},true)`;
    const stages = [
      () => tx.$executeRaw`DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM idempotency_keys WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM household_members WHERE id IN (SELECT id FROM household_members WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 100)`,
      () => tx.$executeRaw`DELETE FROM entitlements WHERE household_id=${householdId}::uuid`,
    ];
    for (let stage = 0; stage < stages.length; stage++) {
      const count = await stages[stage]!();
      if (count) {
        await tx.$executeRaw`INSERT INTO audit_log(household_id,actor_type,action,target_type,target_id,meta)
          VALUES(${householdId}::uuid,'system','privacy.local_batch_erased','household_deletion',${requestId}::uuid,
          jsonb_build_object('stage',${100 + stage}::int,'count',${count}::int,'attempt',${claim.id}::uuid,'resource',${claim.operationId}::uuid))`;
        return { stage, count, onlineRowsDrained: false, finalReceiptIssuable: false as const };
      }
    }
    const minimized = await tx.$executeRaw`UPDATE households SET name=${HOUSEHOLD_ANCHOR_NAME},email_alias=NULL WHERE id=${householdId}::uuid`;
    if (minimized !== 1) throw new Error("Local erasure anchor refused");
    await tx.$executeRaw`INSERT INTO audit_log(household_id,actor_type,action,target_type,target_id,meta)
      VALUES(${householdId}::uuid,'system','privacy.local_batch_erased','household_deletion',${requestId}::uuid,
      jsonb_build_object('stage',${100 + stages.length}::int,'count',0,'anchorMinimized',true,'attempt',${claim.id}::uuid,'resource',${claim.operationId}::uuid))`;
    return { stage: stages.length, count: 0, onlineRowsDrained: true, anchorMinimized: true as const, finalReceiptIssuable: false as const };
  }));
}
