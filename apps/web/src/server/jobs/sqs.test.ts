import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_EXECUTION_BUDGET as budget, encodeJobEnvelope } from "@autobureau/contracts";
const { send, construct, credentials } = vi.hoisted(() => ({ send: vi.fn(), construct: vi.fn(), credentials: vi.fn(() => async () => ({})) }));
vi.mock("@aws-sdk/client-sqs", () => {
  class Command { constructor(readonly input: unknown) {} }
  return { SQSClient: class { constructor(config: unknown) { construct(config); } send = send; destroy() {} },
    SendMessageCommand: class extends Command {}, ReceiveMessageCommand: class extends Command {},
    DeleteMessageCommand: class extends Command {}, ChangeMessageVisibilityCommand: class extends Command {} };
});
vi.mock("@vercel/oidc-aws-credentials-provider", () => ({ awsCredentialsProvider: credentials }));
import { queueConfigFromEnv, QueueError, SqsJobReceiver, SqsJobSender, type QueueConfig } from "./sqs";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", JOB_TRANSPORT_MODE: "synthetic", JOB_AWS_REGION: "us-east-2", VERCEL_ENV: "preview",
  AUTH_ISSUER: "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1", VERCEL_PROJECT_ID: "prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR",
  JOB_AWS_ROLE_ARN: "arn:aws:iam::792394000571:role/pellum-preview-job-dispatcher", DOCUMENT_INTAKE_ENABLED: "false" };
const config: QueueConfig = { scope: "preview", region: "us-east-2", runtime: "pipeline-worker", roleArn: "arn:aws:iam::792394000571:role/pellum-preview-job-pipeline-worker" };
const body = encodeJobEnvelope({ version: 1, event_id: "1", household_id: "11111111-1111-4111-8111-111111111111", event_type: "document.uploaded", consumer: "pipeline" });
const handle = "private-receipt-canary";
const message = () => ({ Messages: [{ Body: body, ReceiptHandle: handle, Attributes: { ApproximateReceiveCount: "1", SentTimestamp: String(Date.now() - 500) } }] });
beforeEach(() => { vi.clearAllMocks(); send.mockResolvedValue({}); });
afterEach(() => vi.useRealTimers());
describe("staging SQS security and lease boundary", () => {
  it("accepts only synthetic mode, exact project/account/region and matching environment role", () => {
    expect(queueConfigFromEnv("dispatcher", env)).toMatchObject({ scope: "preview", runtime: "dispatcher" });
    for (const change of [{ JOB_TRANSPORT_MODE: "live" }, { JOB_TRANSPORT_MODE: "" }, { JOB_AWS_REGION: "us-west-2" },
      { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_PROJECT_ID: "prj_other" },
      { AUTH_ISSUER: "https://hdoknvqnjyttondgidvi.supabase.co/auth/v1" }, { AWS_ACCESS_KEY_ID: "persistent-canary" },
      { AWS_SECRET_ACCESS_KEY: "persistent-canary" }, { DOCUMENT_INTAKE_ENABLED: "true" }, { JOB_AWS_ROLE_ARN: "arn:aws:iam::111111111111:role/other" }]) {
      expect(() => queueConfigFromEnv("dispatcher", { ...env, ...change })).toThrow(QueueError);
    }
    expect(construct).not.toHaveBeenCalled();
  });
  it("rejects direct constructor misuse and keeps runtime permissions separate", () => {
    expect(() => new SqsJobSender(config)).toThrow(QueueError);
    expect(() => new SqsJobReceiver(queueConfigFromEnv("dispatcher", env))).toThrow(QueueError);
    expect(() => new SqsJobReceiver({ ...config, roleArn: "arn:aws:iam::111111111111:role/other" })).toThrow(QueueError);
    expect(() => new SqsJobReceiver({ ...config, scope: "stg" })).toThrow(QueueError);
  });
  it("sends only an opaque body to an exact queue, no message attributes or automatic SDK retry", async () => {
    const sender = new SqsJobSender(queueConfigFromEnv("dispatcher", env)); const signal = AbortSignal.timeout(1000);
    await sender.send("pipeline", body, signal);
    expect(send.mock.calls[0]?.[0].input).toEqual({ QueueUrl: "https://sqs.us-east-2.amazonaws.com/792394000571/pellum-preview-pipeline", MessageBody: body });
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ region: "us-east-2", maxAttempts: 1 }));
    expect(credentials).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 900, roleArn: env.JOB_AWS_ROLE_ARN }));
    await expect(sender.send("notifications", body, signal)).rejects.toThrow(QueueError);
    await expect(sender.send("pipeline", JSON.stringify({ ...JSON.parse(body), token: "private-canary" }), signal)).rejects.toThrow(QueueError);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("returns a static error, never an SDK body, URL, token or receipt handle", async () => {
    const sender = new SqsJobSender(queueConfigFromEnv("dispatcher", env));
    send.mockRejectedValue({ message: "secret-canary", $metadata: { requestId: "secret-canary" }, url: "https://secret-canary" });
    const error = await sender.send("pipeline", body, AbortSignal.timeout(1000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueError); expect(JSON.stringify(error)).not.toContain("secret-canary"); expect(String(error)).not.toContain("secret-canary");
  });
  it("uses one-message long polling and keeps receipt handles out of serialized jobs", async () => {
    send.mockResolvedValueOnce(message()); const receiver = new SqsJobReceiver(config); const job = await receiver.receive();
    expect(job).toEqual({ body, receiveCount: 1, sentAt: expect.any(Number) });
    expect(JSON.stringify(job)).not.toContain(handle);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ WaitTimeSeconds: 20, VisibilityTimeout: 60, MaxNumberOfMessages: 1 });
    await receiver.acknowledge(job!);
    expect(send.mock.calls[1]?.[0].input).toEqual({ QueueUrl: "https://sqs.us-east-2.amazonaws.com/792394000571/pellum-preview-pipeline", ReceiptHandle: handle });
    await expect(receiver.acknowledge(job!)).rejects.toThrow("lease-expired");
  });
  it("refuses forged/cross-receiver receipts and expired acknowledgement", async () => {
    vi.useFakeTimers(); send.mockResolvedValueOnce(message());
    const receiver = new SqsJobReceiver(config), other = new SqsJobReceiver(config), job = await receiver.receive();
    await expect(other.acknowledge(job!)).rejects.toThrow("lease-expired");
    await expect(receiver.acknowledge({ ...job! })).rejects.toThrow("lease-expired");
    vi.advanceTimersByTime(60_000); await expect(receiver.acknowledge(job!)).rejects.toThrow("lease-expired");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("permits one bounded extension and rejects renewal after ambiguity", async () => {
    vi.useFakeTimers(); send.mockResolvedValueOnce(message()); const receiver = new SqsJobReceiver(config), job = await receiver.receive();
    vi.advanceTimersByTime(40_000); await receiver.extend(job!);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({ VisibilityTimeout: 60 });
    await expect(receiver.extend(job!)).rejects.toThrow("lease-expired");
    vi.advanceTimersByTime(60_000); await expect(receiver.acknowledge(job!)).rejects.toThrow("lease-expired");
  });
  it("consumes extension allowance before an ambiguous provider failure", async () => {
    vi.useFakeTimers(); send.mockResolvedValueOnce(message()); const receiver = new SqsJobReceiver(config), job = await receiver.receive();
    vi.advanceTimersByTime(40_000); send.mockRejectedValueOnce(new Error("private-provider-error"));
    await expect(receiver.extend(job!)).rejects.toThrow("unavailable");
    await expect(receiver.extend(job!)).rejects.toThrow("lease-expired");
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejects unexpected attributes and invalid bodies before exposing them to a handler", async () => {
    const receiver = new SqsJobReceiver(config);
    for (const changed of [{ MessageAttributes: { Email: { StringValue: "secret-canary" } } }, { Body: "secret-canary" }, { Attributes: {} }]) {
      send.mockResolvedValueOnce({ Messages: [{ ...message().Messages[0], ...changed }] });
      await expect(receiver.receive()).rejects.toThrow(QueueError);
    }
  });
  it("derives queue visibility from implemented execution limits with safety margin", () => {
    const requiredSeconds = Math.ceil((budget.receiveTimeoutMs + budget.databaseWaitMs + budget.databaseTransactionMs + budget.acknowledgementTimeoutMs) * (1 + budget.safetyMargin) / 1000);
    expect(budget.visibilitySeconds).toBeGreaterThanOrEqual(requiredSeconds);
    expect(budget.visibilitySeconds - requiredSeconds).toBeLessThanOrEqual(1);
    expect(budget.receiveTimeoutMs).toBeGreaterThan(budget.longPollSeconds * 1000);
  });
});
