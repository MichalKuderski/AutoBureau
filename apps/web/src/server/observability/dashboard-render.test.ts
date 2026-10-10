import { afterEach, expect, it } from "vitest";
import { dashboardPhase, observeDashboardTransaction, withDashboardRender } from "./dashboard-render";
import { resetLogSink, setLogSink, type LogRecord } from "./logger";
afterEach(resetLogSink);
it("isolates concurrent renders, caps emission and retains a terminal failure without leaking arbitrary metadata", async () => {
  const records: LogRecord[] = []; setLogSink(r => records.push(r));
  const failure = Object.create(null, { code: { get: () => { throw new Error("PRIVATE"); } } });
  const event = { operation: "household", outcome: "success", acquisition_ms: 1, execution_ms: 2, waiting_at_start: 0, active_at_start: 0, secret: "PRIVATE" } as const;
  await Promise.all([
    expect(withDashboardRender(true, () => dashboardPhase("shell_read", async () => {
      for (let i = 0; i < 150; i++) observeDashboardTransaction(event);
      await Promise.resolve(); throw failure;
    }))).rejects.toBe(failure),
    withDashboardRender(true, () => dashboardPhase("memberships", async () => { await Promise.resolve(); observeDashboardTransaction(event); })),
  ]);
  const terminals = records.filter(r => r.event === "dashboard.render_complete");
  expect(terminals).toHaveLength(2); expect(new Set(terminals.map(r => r.trace_id)).size).toBe(2);
  const failed = terminals.find(r => r.meta?.outcome === "failure")!;
  expect(failed.meta).toMatchObject({ failure_phase: "shell_read" });
  expect(failed.meta?.dropped).toBeGreaterThan(0);
  expect(records.filter(r => r.trace_id === failed.trace_id)).toHaveLength(97);
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  observeDashboardTransaction(event);
  expect(records.filter(r => r.event === "dashboard.render_complete")).toHaveLength(2);
});
it("does not let a failing log sink change the callback's result or thrown value", async () => {
  setLogSink(() => { throw Error("sink down"); });
  expect(await withDashboardRender(true, async () => 7)).toBe(7);
  const failure = new Error("unchanged");
  await expect(withDashboardRender(true, async () => { throw failure; })).rejects.toBe(failure);
});
