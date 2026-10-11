import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsSystem, runAsUser } from "../../src/audit.js";
import { claimJournalRetirement, completeJournalRetirementPlan, planJournalRetirement, observeJournalRetention,
  readJournalRetentionReport, RETIREMENT_CLASSES } from "../../src/journal-retirement.js";
import { readHouseholdDeletionStatus } from "../../src/deletion-journal.js";
import { ADMIN_URL, APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

// ADR-019: planning, holds and observation only. Assertions run as the retention worker,
// the independent verifier and app_user; the administrator only seeds fixtures and time.
let admin: PrismaClient, app: PrismaClient, retention: PrismaClient, verifier: PrismaClient;
let appDb: Database, retentionDb: Database, verifyDb: Database;
const households: string[] = [], users: string[] = [];
const roles = ["app_retention_worker", "app_deletion_verifier"];
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient(); app = new PrismaClient({ datasourceUrl: APP_URL }); appDb = new Database(app);
  const clients: PrismaClient[] = [];
  for (const role of roles) {
    await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'retirement_local_only'`);
    const url = new URL(ADMIN_URL); url.username = role; url.password = "retirement_local_only"; clients.push(new PrismaClient({ datasourceUrl: url.toString() }));
  }
  [retention, verifier] = clients as [PrismaClient, PrismaClient];
  retentionDb = new Database(retention); verifyDb = new Database(verifier);
}, 120_000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    await admin.journalRetirementObservation.deleteMany({ where }); await admin.journalRetirementDecision.deleteMany({ where });
    await admin.journalRetirementRun.deleteMany({ where }); await admin.journalRetirementHold.deleteMany({ where: { OR: [where, { reference: { startsWith: "TEST-" } }] } });
    await admin.householdDeletion.deleteMany({ where }); await admin.outboxEvent.deleteMany({ where });
    await admin.household.deleteMany({ where: { id: { in: households } } }); await admin.auditLog.deleteMany({ where });
    await admin.user.deleteMany({ where: { id: { in: users } } });
    for (const role of roles) await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);
  }
  await Promise.all([admin, app, retention, verifier].map(c => c?.$disconnect()));
});
/** A household whose deletion manifest is sealed (state verifying). `manifestDaysAgo` places it in time. */
async function sealed(manifestDaysAgo = 30, state: "verifying" | "fenced" = "verifying") {
  const hh = randomUUID(), owner = randomUUID(); households.push(hh); users.push(owner);
  await admin.user.create({ data: { id: owner, email: `${owner}@example.test` } });
  await admin.household.create({ data: { id: hh, createdBy: owner, name: "PUBLIC retirement fixture" } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  const at = (days: number) => new Date(Date.now() - days * 86400_000);
  const deletion = await admin.householdDeletion.create({ data: { householdId: hh, requestedBy: owner, requestedAt: at(manifestDaysAgo + 30), undoUntil: at(manifestDaysAgo + 16),
    state, fencedAt: at(manifestDaysAgo + 1), settleUntil: at(manifestDaysAgo + 0.5), manifestAt: state === "verifying" ? at(manifestDaysAgo) : null } });
  await admin.outboxEvent.create({ data: { householdId: hh, eventType: "document.uploaded", aggregateType: "document", aggregateId: randomUUID(), payload: {} } });
  return { hh, owner, deletionId: deletion.id };
}
const refused = (p: Promise<unknown>) => p.then(() => "ok", e => String(e instanceof Error ? e.message : e));

/** Hold the existing DB guard lock until both real worker claims are waiting on it.
 * Old code reads absence before blocking at INSERT; fixed code blocks before its read.
 * No query results are mocked, and the administrator only controls test scheduling. */
async function simultaneousClaims(hh: string, deletionId: string, whileBlocked?: () => Promise<void>) {
  let release!: () => void, ready!: (pid: number) => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<number>(resolve => { ready = resolve; });
  const holder = admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('retirement:'||${hh}::uuid::text,0))`;
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    ready(row!.pid);
    await released;
  }, { timeout: 10_000 });
  // Propagate holder setup failure rather than waiting forever for readiness.
  const pid = await Promise.race([locked, holder.then(() => { throw new Error("Claim gate ended before ready"); })]);
  const outcomes = Promise.allSettled([
    claimJournalRetirement(retentionDb, hh, deletionId),
    claimJournalRetirement(retentionDb, hh, deletionId),
  ]);
  try {
    const deadline = Date.now() + 2_000;
    let waiting = 0;
    do {
      const [row] = await admin.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n
        FROM pg_locks w JOIN pg_stat_activity a ON a.pid=w.pid
        JOIN pg_locks h ON h.pid=${pid} AND h.granted AND h.locktype='advisory'
          AND (w.database,w.classid,w.objid,w.objsubid)=(h.database,h.classid,h.objid,h.objsubid)
        WHERE w.locktype='advisory' AND NOT w.granted AND a.usename='app_retention_worker'`;
      waiting = row!.n;
      if (waiting === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    expect(waiting).toBe(2);
    await whileBlocked?.();
  } finally {
    release();
    await holder;
    await outcomes; // settle worker transactions before fixture cleanup, including on failure
  }
  return outcomes;
}

describe("ADR-019 retirement planning (no purge)", () => {
  it("serializes simultaneous initial claims and leaves another household unblocked", async () => {
    const f = await sealed(), other = await sealed();
    const outcomes = await simultaneousClaims(f.hh, f.deletionId, async () => {
      expect((await claimJournalRetirement(retentionDb, other.hh, other.deletionId)).status).toBe("claimed");
    });
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "fulfilled"]);
    const claims = outcomes.map(o => { if (o.status === "rejected") throw o.reason; return o.value; });
    expect(claims.map(c => c.status).sort()).toEqual(["busy", "claimed"]);
    expect(new Set(claims.map(c => c.runId)).size).toBe(1);
    expect(await admin.journalRetirementRun.findMany({ where: { householdId: f.hh }, select: { state: true, attempts: true } }))
      .toEqual([{ state: "leased", attempts: 1 }]);
  });
  it("keeps serial claims on the same live lease without advancing attempts", async () => {
    const f = await sealed();
    const first = await claimJournalRetirement(retentionDb, f.hh, f.deletionId);
    expect(first.status).toBe("claimed");
    const before = await admin.journalRetirementRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(await claimJournalRetirement(retentionDb, f.hh, f.deletionId))
      .toEqual({ runId: first.runId, token: null, status: "busy" });
    expect(await admin.journalRetirementRun.findUniqueOrThrow({ where: { id: first.runId } })).toEqual(before);
  });
  it("admits exactly one simultaneous takeover of an expired lease", async () => {
    const f = await sealed();
    const first = await claimJournalRetirement(retentionDb, f.hh, f.deletionId);
    await admin.journalRetirementRun.update({ where: { id: first.runId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const outcomes = await simultaneousClaims(f.hh, f.deletionId);
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "fulfilled"]);
    const claims = outcomes.map(o => { if (o.status === "rejected") throw o.reason; return o.value; });
    expect(claims.map(c => c.status).sort()).toEqual(["busy", "claimed"]);
    expect(claims.every(c => c.runId === first.runId)).toBe(true);
    expect(claims.find(c => c.status === "claimed")!.token).not.toBe(first.token);
    expect(await admin.journalRetirementRun.findUniqueOrThrow({ where: { id: first.runId } }))
      .toMatchObject({ state: "leased", attempts: 2 });
  });
  it("records a retain-only decision for every catalog class and seals a database-computed plan digest", async () => {
    const f = await sealed();
    const r = await planJournalRetirement(retentionDb, f.hh, f.deletionId);
    expect(r.status).toBe("planned");
    const decisions = await admin.journalRetirementDecision.findMany({ where: { householdId: f.hh }, orderBy: { classId: "asc" } });
    expect(decisions.map(d => d.classId)).toEqual(Object.keys(RETIREMENT_CLASSES).sort());
    for (const d of decisions) { expect(d.eligible).toBe(false); expect(d.reasons).toContain("adr019-restore-authority-absent"); }
    const run = await admin.journalRetirementRun.findUniqueOrThrow({ where: { deletionId: f.deletionId } });
    expect(run).toMatchObject({ state: "planned", leaseToken: null, leaseUntil: null, attempts: 1 });
    expect(run.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await planJournalRetirement(retentionDb, f.hh, f.deletionId)).toMatchObject({ status: "planned", runId: run.id });
    expect(await admin.journalRetirementDecision.count({ where: { householdId: f.hh } })).toBe(11);
  });
  it("refuses to plan before the deletion manifest is sealed", async () => {
    const f = await sealed(30, "fenced");
    expect(await refused(claimJournalRetirement(retentionDb, f.hh, f.deletionId))).toMatch(/sealed deletion manifest/);
    expect(await admin.journalRetirementRun.count({ where: { householdId: f.hh } })).toBe(0);
  });
  it("admits one planner, and a crashed lease is taken over only after expiry with a fresh token, at most three times", async () => {
    const f = await sealed();
    const claims = await Promise.all([claimJournalRetirement(retentionDb, f.hh, f.deletionId), claimJournalRetirement(retentionDb, f.hh, f.deletionId)]);
    expect(claims.map(c => c.status).sort()).toEqual(["busy", "claimed"]);
    const first = claims.find(c => c.status === "claimed")!;
    // The first planner "crashes" after claiming: nothing else was written.
    expect(await admin.journalRetirementDecision.count({ where: { householdId: f.hh } })).toBe(0);
    expect((await claimJournalRetirement(retentionDb, f.hh, f.deletionId)).status).toBe("busy");
    // The database itself refuses to hand a LIVE lease to another token (no TypeScript pre-check).
    expect(await refused(runAsSystem("live takeover", () => retentionDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE journal_retirement_runs SET state='leased',lease_token=gen_random_uuid() WHERE id=${first.runId}::uuid`)))).toMatch(/takeover refused/);
    await admin.journalRetirementRun.update({ where: { id: first.runId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const second = await claimJournalRetirement(retentionDb, f.hh, f.deletionId);
    expect(second).toMatchObject({ status: "claimed", runId: first.runId });
    expect(await refused(completeJournalRetirementPlan(retentionDb, f.hh, first.runId, first.token!))).toMatch(/live lease|expired or foreign/);
    for (let i = 0; i < 2; i++) {
      await admin.journalRetirementRun.update({ where: { id: first.runId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const again = await claimJournalRetirement(retentionDb, f.hh, f.deletionId);
      if (i === 0) expect(again.status).toBe("claimed"); else expect(again.status).toBe("exhausted");
    }
    expect(await admin.journalRetirementRun.findUniqueOrThrow({ where: { id: first.runId } })).toMatchObject({ attempts: 3, state: "leased" });
  });
  it("every open hold, including one past its review date, must appear in the reasons", async () => {
    const f = await sealed(1);
    await admin.journalRetirementHold.create({ data: { householdId: f.hh, classId: "outbox", reason: "incident", reference: "TEST-INC-1", reviewBy: new Date(Date.now() + 86400_000) } });
    await admin.journalRetirementHold.create({ data: { householdId: null, classId: "all", reason: "legal", reference: "TEST-LEGAL-1", placedAt: new Date(Date.now() - 10 * 86400_000), reviewBy: new Date(Date.now() - 86400_000) } });
    const r = await planJournalRetirement(retentionDb, f.hh, f.deletionId);
    const byClass = Object.fromEntries((r as { plan: Array<{ classId: string; reasons: string[] }> }).plan.map(p => [p.classId, p.reasons]));
    expect(byClass.outbox).toEqual(["adr019-restore-authority-absent", "hold-review-overdue", "incident-hold", "legal-hold", "replay-window-open"]);
    expect(byClass.scan).toEqual(["adr019-restore-authority-absent", "hold-review-overdue", "legal-hold", "replay-window-open"]);
    expect(byClass.audit).toEqual(["adr019-restore-authority-absent", "hold-review-overdue", "legal-hold"]);
    // Raw restricted SQL cannot record a decision that omits an open hold.
    const g = await sealed(1), claim = await claimJournalRetirement(retentionDb, g.hh, g.deletionId);
    const omit = runAsSystem("omit hold", () => retentionDb.withHousehold(g.hh, async tx => {
      await tx.$executeRaw`SELECT set_config('request.retirement_token',${claim.token},true)`;
      await tx.$executeRaw`INSERT INTO journal_retirement_decisions(household_id,run_id,class_id,reasons) VALUES(${g.hh}::uuid,${claim.runId}::uuid,'audit',ARRAY['adr019-restore-authority-absent']::text[])`;
    }));
    expect(await refused(omit)).toMatch(/omits an open hold/);
    // A global hold binds every household; release it so later cases start unheld.
    await admin.journalRetirementHold.updateMany({ where: { reference: "TEST-LEGAL-1" }, data: { releasedAt: new Date() } });
  });
  it("no role can mark a class eligible, rewrite or delete evidence, or write holds", async () => {
    const f = await sealed(); const r = await planJournalRetirement(retentionDb, f.hh, f.deletionId);
    const as = (db: Database, sql: (tx: Parameters<Parameters<Database["withHousehold"]>[1]>[0]) => Promise<unknown>) => refused(runAsSystem("negative control", () => db.withHousehold(f.hh, sql)));
    expect(await as(retentionDb, tx => tx.$executeRaw`UPDATE journal_retirement_decisions SET reasons=ARRAY['adr019-restore-authority-absent']::text[] WHERE household_id=${f.hh}::uuid`)).toMatch(/permission denied/);
    expect(await as(retentionDb, tx => tx.$executeRaw`DELETE FROM journal_retirement_decisions WHERE household_id=${f.hh}::uuid`)).toMatch(/permission denied/);
    expect(await as(retentionDb, tx => tx.$executeRaw`INSERT INTO journal_retirement_holds(class_id,reason,reference,review_by) VALUES('all','legal','TEST-X',clock_timestamp()+interval '1 day')`)).toMatch(/permission denied/);
    expect(await as(verifyDb, tx => tx.$executeRaw`DELETE FROM journal_retirement_observations WHERE household_id=${f.hh}::uuid`)).toMatch(/permission denied/);
    expect(await refused(runAsUser(f.owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE journal_retirement_runs SET state='planned' WHERE household_id=${f.hh}::uuid`)))).toMatch(/permission denied/);
    // Even the fixture administrator cannot record eligibility: the database forbids it.
    await expect(admin.$executeRaw`INSERT INTO journal_retirement_decisions(household_id,run_id,class_id,eligible,reasons) VALUES(${f.hh}::uuid,${r.runId}::uuid,'scan',true,ARRAY['adr019-restore-authority-absent']::text[])`).rejects.toThrow(/check constraint|duplicate/);
    const g = await sealed(), c = await claimJournalRetirement(retentionDb, g.hh, g.deletionId);
    await expect(admin.$executeRaw`INSERT INTO journal_retirement_decisions(household_id,run_id,class_id,eligible,reasons) VALUES(${g.hh}::uuid,${c.runId}::uuid,'scan',true,ARRAY['adr019-restore-authority-absent']::text[])`).rejects.toThrow(/check constraint/);
  });
  it("the independent verifier counts retained rows only after planning, and the owner's report shows codes and counts", async () => {
    const f = await sealed(), c = await claimJournalRetirement(retentionDb, f.hh, f.deletionId);
    expect(await refused(observeJournalRetention(verifyDb, f.hh, c.runId))).toMatch(/observation refused/);
    await completeJournalRetirementPlan(retentionDb, f.hh, c.runId, c.token!);
    const seen = await observeJournalRetention(verifyDb, f.hh, c.runId);
    const outbox = seen.find(s => s.classId === "outbox")!, deletion = seen.find(s => s.classId === "deletion")!;
    expect(outbox.retainedRows).toBe(await admin.outboxEvent.count({ where: { householdId: f.hh } }));
    expect(deletion.retainedRows).toBeGreaterThanOrEqual(1 + 1 + 11); // deletion request, run, decisions
    expect(await observeJournalRetention(verifyDb, f.hh, c.runId)).toEqual(seen);
    const report = await runAsUser(f.owner, () => readJournalRetentionReport(appDb, f.hh));
    expect(report).toHaveLength(11);
    expect(report.find(x => x.classId === "outbox")).toMatchObject({ eligible: false, retainedRows: outbox.retainedRows, reasons: expect.arrayContaining(["adr019-restore-authority-absent"]) });
    expect(JSON.stringify(report)).not.toMatch(/payload|storage|token|sha256/i);
    const status = await runAsUser(f.owner, () => readHouseholdDeletionStatus(appDb, f.hh));
    expect(status).toMatchObject({ finalReceiptIssuable: false, providerErasure: "unverified", backupExpiry: "unverified",
      scope: { household: true, signInAccount: "not-in-scope" }, providers: { billing: "none", financial: "none" } });
    expect((status as { retainedEvidence: unknown[] }).retainedEvidence).toHaveLength(11);
  });
  it("replay windows are open for recently sealed manifests and closed later, but restore protection remains", async () => {
    const fresh = await sealed(1), old = await sealed(40);
    const a = await planJournalRetirement(retentionDb, fresh.hh, fresh.deletionId), b = await planJournalRetirement(retentionDb, old.hh, old.deletionId);
    const reasons = (x: unknown, cls: string) => (x as { plan: Array<{ classId: string; reasons: string[] }> }).plan.find(p => p.classId === cls)!.reasons;
    expect(reasons(a, "outbox")).toContain("replay-window-open"); expect(reasons(a, "scan")).toContain("replay-window-open");
    expect(reasons(b, "outbox")).toEqual(["adr019-restore-authority-absent"]);
  });
});
