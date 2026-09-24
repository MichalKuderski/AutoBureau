import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { runAsSystem } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";

/**
 * ADR-019 journal retirement — the locally safe part: bounded, leased, crash-recoverable
 * PLANNING, hold honesty and independent retained-row observation. There is no purge:
 * every class carries a restore dependency and no independently operated restore authority
 * exists, so every decision is "retain" and the database refuses anything else.
 */
export const RETIREMENT_CLASSES = {
  scan: ["document_scans", "document_scan_attempts"],
  custody: ["document_custodies"],
  processing: ["document_processing"],
  results: ["document_results", "document_result_reviews", "document_period_decisions"],
  outbox: ["outbox_events", "job_deliveries", "job_inbox"],
  "account-security": ["account_security_challenges"],
  exports: ["local_export_artifacts"],
  stripe: ["stripe_test_bindings", "stripe_test_notices", "stripe_test_states", "stripe_test_intents"],
  plaid: ["plaid_local_subjects", "plaid_local_exchanges", "plaid_local_items", "plaid_local_credentials", "plaid_local_item_routes",
    "plaid_local_cursors", "plaid_local_webhooks", "plaid_local_accounts", "plaid_local_transactions"],
  deletion: ["household_deletions", "deletion_resources", "deletion_attempts", "deletion_observations",
    "journal_retirement_runs", "journal_retirement_decisions", "journal_retirement_observations"],
  audit: ["audit_log"],
} as const;
export type RetirementClass = keyof typeof RETIREMENT_CLASSES;
const CLASSES = Object.keys(RETIREMENT_CLASSES).sort() as RetirementClass[];
/** Engineering proposals recorded in the catalog (ADR-019), not established provider policy. */
const REPLAY_WINDOW_DAYS: Partial<Record<RetirementClass, number>> = { outbox: 14, scan: 7 };
export class JournalRetirementRefused extends Error { constructor(message: string) { super(message); } }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

async function holdsFor(tx: ScopedClient, hh: string) {
  return tx.$queryRaw<Array<{ class_id: string; reason: string; overdue: boolean }>>`
    SELECT class_id, reason, review_by<=clock_timestamp() AS overdue FROM journal_retirement_holds
    WHERE released_at IS NULL AND (household_id IS NULL OR household_id=${hh}::uuid)`;
}
/** Step 1 (its own committed transaction): claim a fresh lease, or take over an expired one. */
export async function claimJournalRetirement(db: Database, hh: string, deletionId: string) {
  if (!uuid.test(hh) || !uuid.test(deletionId)) throw new JournalRetirementRefused("Retirement planning refused");
  return runAsSystem("Claim ADR-019 retirement planning lease (no purge)", () => db.withHousehold(hh, async tx => {
    const [run] = await tx.$queryRaw<Array<{ id: string; state: string; expired: boolean; attempts: number }>>`SELECT id,state,lease_until<=clock_timestamp() AS expired,attempts
      FROM journal_retirement_runs WHERE deletion_id=${deletionId}::uuid AND household_id=${hh}::uuid`;
    const token = randomUUID();
    if (!run) {
      const [created] = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO journal_retirement_runs(household_id,deletion_id,catalog_version,lease_token)
        VALUES(${hh}::uuid,${deletionId}::uuid,1,${token}::uuid) RETURNING id`;
      return { runId: created!.id, token, status: "claimed" as const };
    }
    if (run.state === "planned") return { runId: run.id, token: null, status: "planned" as const };
    if (!run.expired) return { runId: run.id, token: null, status: "busy" as const };
    // Three crashed planners: stop and surface it; an operator must investigate, never loop.
    if (run.attempts >= 3) return { runId: run.id, token: null, status: "exhausted" as const };
    const n = await tx.$executeRaw`UPDATE journal_retirement_runs SET state='leased',lease_token=${token}::uuid
      WHERE id=${run.id}::uuid AND household_id=${hh}::uuid AND state='leased' AND lease_until<=clock_timestamp()`;
    return n === 1 ? { runId: run.id, token, status: "claimed" as const } : { runId: run.id, token: null, status: "busy" as const };
  }));
}
/** Step 2 (one transaction under the live lease): record every class's retain decision and seal the plan. */
export async function completeJournalRetirementPlan(db: Database, hh: string, runId: string, token: string) {
  return runAsSystem("Record ADR-019 retain decisions (no purge)", () => db.withHousehold(hh, async tx => {
    await tx.$executeRaw`SELECT set_config('request.retirement_token',${token},true)`;
    const [d] = await tx.$queryRaw<Array<{ manifest_at: Date | null }>>`SELECT d.manifest_at FROM journal_retirement_runs r
      JOIN household_deletions d ON d.id=r.deletion_id WHERE r.id=${runId}::uuid AND r.household_id=${hh}::uuid`;
    if (!d) throw new JournalRetirementRefused("Retirement planning refused");
    const holds = await holdsFor(tx, hh);
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const plan = CLASSES.map(classId => {
      const reasons = new Set<string>(["adr019-restore-authority-absent"]);
      for (const h of holds.filter(h => h.class_id === "all" || h.class_id === classId)) { reasons.add(`${h.reason}-hold`); if (h.overdue) reasons.add("hold-review-overdue"); }
      const days = REPLAY_WINDOW_DAYS[classId];
      if (days !== undefined && d.manifest_at && clock!.now.getTime() < d.manifest_at.getTime() + days * 86400_000) reasons.add("replay-window-open");
      return { classId, eligible: false as const, reasons: [...reasons].sort() };
    });
    for (const p of plan) {
      await tx.$executeRaw`INSERT INTO journal_retirement_decisions(household_id,run_id,class_id,reasons) VALUES(${hh}::uuid,${runId}::uuid,${p.classId},${p.reasons}::text[])`;
    }
    const n = await tx.$executeRaw`UPDATE journal_retirement_runs SET state='planned' WHERE id=${runId}::uuid AND household_id=${hh}::uuid AND lease_token=${token}::uuid`;
    if (n !== 1) throw new JournalRetirementRefused("Retirement lease expired or foreign");
    return plan;
  }));
}
/** Convenience: claim then complete. A crash between the two leaves a lease another planner may take over after expiry. */
export async function planJournalRetirement(db: Database, hh: string, deletionId: string) {
  const claim = await claimJournalRetirement(db, hh, deletionId);
  if (claim.status !== "claimed") return { runId: claim.runId, status: claim.status };
  const plan = await completeJournalRetirementPlan(db, hh, claim.runId, claim.token!);
  return { runId: claim.runId, status: "planned" as const, plan };
}
/** Independent verifier: counts what is RETAINED per class (identifiers only) after planning. */
export async function observeJournalRetention(db: Database, hh: string, runId: string) {
  return runAsSystem("Independently observe retained journal evidence", () => db.withHousehold(hh, async tx => {
    const out: Array<{ classId: RetirementClass; retainedRows: number }> = [];
    for (const classId of CLASSES) {
      let total = 0;
      for (const table of RETIREMENT_CLASSES[classId]) {
        // Closed identifiers from the constant map above; never user input.
        const [row] = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*) AS n FROM ${Prisma.raw(`public.${table}`)} WHERE household_id=${hh}::uuid`);
        total += Number(row!.n);
      }
      const existing = await tx.$queryRaw<Array<{ retained_rows: bigint }>>`SELECT retained_rows FROM journal_retirement_observations WHERE run_id=${runId}::uuid AND class_id=${classId}`;
      if (!existing.length) await tx.$executeRaw`INSERT INTO journal_retirement_observations(household_id,run_id,class_id,retained_rows) VALUES(${hh}::uuid,${runId}::uuid,${classId},${total})`;
      out.push({ classId, retainedRows: existing.length ? Number(existing[0]!.retained_rows) : total });
    }
    return out;
  }));
}
/** Owner-visible, content-free report: which evidence classes are retained, why, and how many rows. */
export async function readJournalRetentionReport(db: Database, hh: string) {
  return db.withHousehold(hh, async tx => {
    const rows = await tx.$queryRaw<Array<{ class_id: string; reasons: string[]; retained_rows: bigint | null; planned_at: Date | null }>>`
      SELECT d.class_id, d.reasons, o.retained_rows, r.planned_at FROM journal_retirement_runs r
      JOIN journal_retirement_decisions d ON d.run_id=r.id AND d.household_id=r.household_id
      LEFT JOIN journal_retirement_observations o ON o.run_id=r.id AND o.class_id=d.class_id AND o.household_id=r.household_id
      WHERE r.household_id=${hh}::uuid AND r.state='planned' ORDER BY d.class_id`;
    return rows.map(r => ({ classId: r.class_id, reasons: r.reasons, retainedRows: r.retained_rows === null ? null : Number(r.retained_rows), eligible: false as const }));
  });
}
