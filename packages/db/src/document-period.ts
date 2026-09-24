import { currentActor, recordAudit } from "./audit.js";
import { approveSyntheticResultInTransaction } from "./document-results.js";
import type { Database, ScopedClient } from "./scoped.js";

/**
 * PRD §21.3 — finished-but-unfiled results. Owner-only. The database is the authority:
 * `document_period_decisions` records an immutable decision bound to the exact work and
 * result, and the reviewed-completion guard admits an old-period result only into the
 * CURRENT month under that decision (one slot, capacity permitting). Nothing here
 * reprocesses, retries a provider, moves money or deletes the original upload.
 */
export type DocumentResultState =
  | "none" | "awaiting-review" | "action-required" | "capacity-unavailable" | "applied"
  | "discarded" | "held" | "deletion-fenced" | "operator-review-required" | "incompatible-result";
export interface DocumentResultView {
  documentId: string; resultId: string | null; state: DocumentResultState;
  resultPeriodStart: string | null; currentPeriodStart: string; chargedPeriodStart: string | null;
  capacity: { used: number; limit: number } | null;
  canApply: boolean; canDiscard: boolean; localOnly: true;
}
export class DocumentResultRefused extends Error {
  constructor(readonly reason: "not-found" | "not-actionable" | "capacity" | "unavailable") { super("Document result action refused"); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Row = {
  result_id: string | null; result_period: Date | null; current_start: Date; fenced: boolean; incompatible: boolean;
  work_state: string | null; result_ref: string | null; charged_at: Date | null; work_period: Date | null;
  custody_ok: boolean; decision: string | null; used: bigint; plan_limit: number | null; reviewed: boolean;
};
function owner() {
  const actor = currentActor();
  if (actor?.type !== "user") throw new DocumentResultRefused("unavailable");
  return actor.userId;
}
async function assertOwner(tx: ScopedClient, hh: string, userId: string) {
  const ok = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT EXISTS(SELECT 1 FROM household_users hu JOIN users u ON u.id=hu.user_id
    WHERE hu.household_id=${hh}::uuid AND hu.user_id=${userId}::uuid AND hu.role='owner' AND u.status='active') AS ok`;
  if (!ok[0]?.ok) throw new DocumentResultRefused("unavailable");
}
async function load(tx: ScopedClient, hh: string, documentId: string) {
  const [row] = await tx.$queryRaw<Row[]>`
    WITH clock AS MATERIALIZED(SELECT clock_timestamp() AS at),
    t AS (SELECT at, date_trunc('month', at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start FROM clock),
    r AS (SELECT * FROM document_results WHERE document_id=${documentId}::uuid AND household_id=${hh}::uuid ORDER BY created_at DESC, id DESC LIMIT 1)
    SELECT r.id AS result_id, r.period_start AS result_period, t.start AS current_start,
      EXISTS(SELECT 1 FROM household_deletions d WHERE d.household_id=${hh}::uuid AND d.state IN ('fenced','verifying','completed')) AS fenced,
      coalesce(r.schema_version<>1 OR r.parser_version<>'canonical-public-deadline-pdf-v1' OR r.redactor_version<>'closed-enums-v1' OR r.source_sha256<>c.sha256, false) AS incompatible,
      w.state AS work_state, w.result_ref, w.charged_at, w.period_start AS work_period,
      coalesce(c.state='ready' AND c.review_at>t.at, false) AS custody_ok,
      (SELECT x.decision FROM document_period_decisions x WHERE x.processing_id=w.id AND x.household_id=w.household_id) AS decision,
      (SELECT count(*) FROM document_processing o WHERE o.household_id=${hh}::uuid AND o.id IS DISTINCT FROM w.id AND o.period_start=t.start
        AND o.state IN ('reserved','started','indeterminate','completed')) AS used,
      (SELECT p.documents_per_month FROM effective_plan p WHERE p.household_id=${hh}::uuid) AS plan_limit,
      EXISTS(SELECT 1 FROM document_result_reviews v WHERE v.result_id=r.id AND v.household_id=r.household_id) AS reviewed
    FROM t LEFT JOIN r ON true
    LEFT JOIN document_processing w ON w.id=r.processing_id AND w.household_id=r.household_id
    LEFT JOIN document_custodies c ON c.id=r.custody_id AND c.household_id=r.household_id`;
  return row!;
}
function view(documentId: string, r: Row): DocumentResultView {
  const used = Number(r.used), limit = r.plan_limit;
  const base = { documentId, resultId: r.result_id, resultPeriodStart: r.result_period?.toISOString() ?? null,
    currentPeriodStart: r.current_start.toISOString(), chargedPeriodStart: null as string | null,
    capacity: limit === null ? null : { used, limit }, canApply: false, canDiscard: false, localOnly: true as const };
  if (!r.result_id) return { ...base, state: "none" };
  if (r.fenced) return { ...base, state: "deletion-fenced" };
  if (r.decision === "discard") return { ...base, state: "discarded" };
  if (r.work_state === "completed" && r.result_ref === r.result_id && r.reviewed)
    return { ...base, state: "applied", chargedPeriodStart: r.work_period?.toISOString() ?? null };
  if (r.incompatible) return { ...base, state: "incompatible-result" };
  if (r.work_state !== "started" && r.work_state !== "indeterminate" || r.charged_at || r.result_period?.getTime() !== r.work_period?.getTime())
    return { ...base, state: "operator-review-required" };
  const pending = { ...base, canDiscard: true };
  if (!r.custody_ok) return { ...pending, state: "held" };
  if (limit === null) return { ...pending, state: "operator-review-required" };
  const room = used < limit, old = r.result_period!.getTime() < r.current_start.getTime();
  if (!room) return { ...pending, state: "capacity-unavailable" };
  return { ...pending, canApply: true, state: old ? "action-required" : "awaiting-review" };
}
/** Owner-only, metadata-only view of a document's latest result (no content or citation text). */
export async function readDocumentResultState(db: Database, hh: string, documentId: string) {
  const userId = owner();
  if (!uuid.test(documentId)) throw new DocumentResultRefused("not-found");
  return db.withHousehold(hh, async tx => {
    await assertOwner(tx, hh, userId);
    if (!await tx.document.findFirst({ where: { id: documentId, householdId: hh }, select: { id: true } })) throw new DocumentResultRefused("not-found");
    return view(documentId, await load(tx, hh, documentId));
  });
}
async function classify(db: Database, hh: string, documentId: string): Promise<never> {
  const state = await readDocumentResultState(db, hh, documentId).then(v => v.state, () => null);
  throw new DocumentResultRefused(state === "capacity-unavailable" ? "capacity" : state === "applied" || state === "discarded" ? "not-actionable" : "unavailable");
}
/**
 * "Apply this result this month": for an old-period result, records the owner's decision
 * and files the existing immutable result in ONE transaction; the database charges exactly
 * one current-month slot or refuses (capacity, fence, suspension, custody expiry). A
 * current-month result is filed through the same reviewed approval. Replays are idempotent.
 */
export async function applyDocumentResult(db: Database, hh: string, documentId: string, resultId: string) {
  const userId = owner();
  if (!uuid.test(documentId) || !uuid.test(resultId)) throw new DocumentResultRefused("not-found");
  try {
    return await db.withHousehold(hh, async tx => {
      await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`processing-quota:${hh}`},0))`;
      await assertOwner(tx, hh, userId);
      const current = view(documentId, await load(tx, hh, documentId));
      if (current.resultId !== resultId) throw new DocumentResultRefused("not-found");
      if (current.state === "applied") return { ...(await approveSyntheticResultInTransaction(tx, hh, userId, resultId)), state: "applied" as const };
      if (current.state === "capacity-unavailable") throw new DocumentResultRefused("capacity");
      if (!current.canApply) throw new DocumentResultRefused("not-actionable");
      if (current.state === "action-required") {
        await tx.$executeRaw`INSERT INTO document_period_decisions(household_id,processing_id,result_id,owner_id,decision)
          SELECT household_id,processing_id,id,${userId}::uuid,'apply-current-period' FROM document_results WHERE id=${resultId}::uuid AND household_id=${hh}::uuid`;
      }
      const filed = await approveSyntheticResultInTransaction(tx, hh, userId, resultId);
      return { ...filed, state: "applied" as const };
    });
  } catch (e) {
    if (e instanceof DocumentResultRefused) throw e;
    return classify(db, hh, documentId);
  }
}
/** Discard: never charged, the original upload stays; the decision and cancellation are atomic. */
export async function discardDocumentResult(db: Database, hh: string, documentId: string, resultId: string) {
  const userId = owner();
  if (!uuid.test(documentId) || !uuid.test(resultId)) throw new DocumentResultRefused("not-found");
  try {
    return await db.withHousehold(hh, async tx => {
      await tx.$executeRaw`SELECT app.assert_household_open(${hh}::uuid)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`processing-quota:${hh}`},0))`;
      await assertOwner(tx, hh, userId);
      const current = view(documentId, await load(tx, hh, documentId));
      if (current.resultId !== resultId) throw new DocumentResultRefused("not-found");
      if (current.state === "discarded") return { state: "discarded" as const, replayed: true };
      if (!current.canDiscard) throw new DocumentResultRefused("not-actionable");
      await tx.$executeRaw`INSERT INTO document_period_decisions(household_id,processing_id,result_id,owner_id,decision)
        SELECT household_id,processing_id,id,${userId}::uuid,'discard' FROM document_results WHERE id=${resultId}::uuid AND household_id=${hh}::uuid`;
      const n = await tx.$executeRaw`UPDATE document_processing w SET state='cancelled' FROM document_results r
        WHERE r.id=${resultId}::uuid AND r.household_id=${hh}::uuid AND w.id=r.processing_id AND w.household_id=r.household_id AND w.state IN ('started','indeterminate')`;
      if (n !== 1) throw new DocumentResultRefused("not-actionable");
      await tx.$executeRaw`UPDATE document_custodies c SET state='cancelled' FROM document_results r
        WHERE r.id=${resultId}::uuid AND r.household_id=${hh}::uuid AND c.id=r.custody_id AND c.household_id=r.household_id AND c.state IN ('copying','ready','held')`;
      await tx.$executeRaw`UPDATE documents SET status='discarded', updated_at=clock_timestamp() WHERE id=${documentId}::uuid AND household_id=${hh}::uuid`;
      await recordAudit(tx, "document.processing_transitioned", { type: "document", id: documentId });
      return { state: "discarded" as const, replayed: false };
    });
  } catch (e) {
    if (e instanceof DocumentResultRefused) throw e;
    return classify(db, hh, documentId);
  }
}
