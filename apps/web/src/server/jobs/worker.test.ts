import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, JobHandlers } from "@autobureau/db";
const { consume, log } = vi.hoisted(() => ({ consume: vi.fn(), log: vi.fn() }));
vi.mock("@autobureau/db", () => ({ consumeDelivery: consume }));
vi.mock("@/server/observability", () => ({ log }));
import { jobMetric, runJobOnce } from "./worker";
import type { SqsJobReceiver } from "./sqs";
const database = {} as Database, handlers: JobHandlers = {};
const job = { body: "opaque-reference", receiveCount: 1, sentAt: Date.now() - 1000 };
function receiver() { return { scope: "stg", queue: "pipeline", receive: vi.fn().mockResolvedValue(job), acknowledge: vi.fn().mockResolvedValue(undefined) }; }
beforeEach(() => vi.clearAllMocks());
describe("one-shot worker acknowledgement", () => {
  it.each(["completed", "duplicate"])("acknowledges %s only after the database resolves", async (result) => {
    const r = receiver(); const calls: string[] = [];
    consume.mockImplementation(async () => { calls.push("commit"); return result; });
    r.acknowledge.mockImplementation(async () => { calls.push("ack"); });
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe(result);
    expect(calls).toEqual(["commit", "ack"]); expect(r.receive).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge a failed or refused domain transaction", async () => {
    const r = receiver(); consume.mockRejectedValueOnce(new Error("private-handler-canary"));
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("retry");
    expect(r.acknowledge).not.toHaveBeenCalled();
    consume.mockResolvedValueOnce("refused");
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("refused");
    expect(r.acknowledge).not.toHaveBeenCalled(); expect(JSON.stringify(log.mock.calls)).not.toContain("private-handler-canary");
  });
  it("leaves post-commit acknowledgement failure for idempotent broker replay", async () => {
    const r = receiver(); consume.mockResolvedValueOnce("completed"); r.acknowledge.mockRejectedValueOnce(new Error("receipt-canary"));
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("retry");
    expect(consume).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toContain("receipt-canary");
  });
  it("records exhaustion after the third failed delivery without an automatic replay loop", async () => {
    const r = receiver(); r.receive.mockResolvedValue({ ...job, receiveCount: 3 }); consume.mockRejectedValue(new Error("poison"));
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("exhausted");
    expect(r.receive).toHaveBeenCalledTimes(1); expect(r.acknowledge).not.toHaveBeenCalled();
  });
  it("does not consume an over-budget fourth receive", async () => {
    const r = receiver(); r.receive.mockResolvedValue({ ...job, receiveCount: 4 });
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("exhausted");
    expect(consume).not.toHaveBeenCalled(); expect(r.acknowledge).not.toHaveBeenCalled();
  });
  it("records invalid/provider receives and idles once for an empty queue", async () => {
    const r = receiver(); r.receive.mockRejectedValueOnce(new Error("raw-transport-canary"));
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("retry");
    r.receive.mockResolvedValueOnce(null);
    expect(await runJobOnce(database, r as unknown as SqsJobReceiver, handlers)).toBe("idle");
    expect(consume).not.toHaveBeenCalled(); expect(JSON.stringify(log.mock.calls)).not.toContain("raw-transport-canary");
  });
  it("emits fixed metric fields without tenant, document, receipt or payload values", () => {
    jobMetric("processing_failure", "stg", "pipeline");
    expect(log).toHaveBeenCalledWith({ event: "jobs.processing_failure", level: "error", traceId: expect.any(String), meta: { job_scope: "stg", job_queue: "pipeline", value: 1 } });
    expect(() => jobMetric("processing_failure", "stg", "pipeline", NaN)).toThrow();
    expect(() => jobMetric("processing_failure", "stg", "pipeline", -1)).toThrow();
  });
});
