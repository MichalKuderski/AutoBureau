import { beforeEach, describe, expect, it, vi } from "vitest";
const { send, log } = vi.hoisted(() => ({ send: vi.fn(), log: vi.fn() }));
vi.mock("@aws-sdk/client-cloudwatch", () => ({ CloudWatchClient: class { send = send; destroy() {} }, PutMetricDataCommand: class { constructor(readonly input: unknown) {} } }));
vi.mock("@vercel/oidc-aws-credentials-provider", () => ({ awsCredentialsProvider: () => async () => ({}) }));
vi.mock("@/server/observability", () => ({ log }));
import { JobMetricBatch } from "./metrics";
import { QueueError, type QueueConfig } from "./sqs";
const config: QueueConfig = { scope: "stg", region: "us-east-2", runtime: "pipeline-worker", roleArn: "arn:aws:iam::792394000571:role/pellum-stg-job-pipeline-worker" };
beforeEach(() => { vi.clearAllMocks(); send.mockResolvedValue({}); });
describe("bounded staging telemetry", () => {
  it("batches counters and maximum lag with no high-cardinality dimensions", async () => {
    const m = new JobMetricBatch(config, "pipeline"); m.record("received"); m.record("received"); m.record("delivery_lag_ms", 200); m.record("delivery_lag_ms", 100);
    await m.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({ Namespace: "Pellum/StagingJobs/stg/pipeline", MetricData: [
      { MetricName: "received", Value: 2, Unit: "Count" }, { MetricName: "delivery_lag_ms", Value: 200, Unit: "Milliseconds" },
    ] });
    await m.flush(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-queue, cross-environment and arbitrary counter input", () => {
    expect(() => new JobMetricBatch(config, "notifications")).toThrow(QueueError);
    expect(() => new JobMetricBatch({ ...config, scope: "preview" }, "pipeline")).toThrow(QueueError);
    const m = new JobMetricBatch(config, "pipeline");
    expect(() => m.record("received", -1)).toThrow(QueueError); expect(() => m.record("received", Infinity)).toThrow(QueueError);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not replay ambiguous metrics or expose provider errors", async () => {
    const m = new JobMetricBatch(config, "pipeline"); m.record("received"); send.mockRejectedValueOnce(new Error("secret-canary"));
    await expect(m.flush()).rejects.toThrow("Staging queue: unavailable");
    await m.flush(); expect(send).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toContain("secret-canary");
  });
});
