import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { decodeJobEnvelope, encodeJobEnvelope, JOB_EXECUTION_BUDGET as budget, jobQueue,
  type JobEnvelope, type JobQueue, type JobScope } from "@autobureau/contracts";
import type { JobTransport } from "@autobureau/db";

export class QueueError extends Error {
  override name = "QueueError";
  constructor(readonly code: "invalid" | "unavailable" | "lease-expired") { super(`Staging queue: ${code}`); }
}
type Runtime = "dispatcher" | "pipeline-worker" | "notifications-worker";
export interface QueueConfig { scope: JobScope; runtime: Runtime; roleArn: string; region: "us-east-2" }
export function queueConfigFromEnv(runtime: Runtime, env: NodeJS.ProcessEnv = process.env): QueueConfig {
  const scope = env["VERCEL_ENV"] === "production" ? "stg" : env["VERCEL_ENV"] === "preview" ? "preview" : null;
  const roleArn = `arn:aws:iam::792394000571:role/pellum-${scope}-job-${runtime}`;
  if (!scope || env["JOB_TRANSPORT_MODE"] !== "synthetic" || env["JOB_AWS_REGION"] !== "us-east-2"
    || env["AUTH_ISSUER"] !== "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1"
    || env["VERCEL_PROJECT_ID"] !== "prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR"
    || env["JOB_AWS_ROLE_ARN"] !== roleArn || env["AWS_ACCESS_KEY_ID"] || env["AWS_SECRET_ACCESS_KEY"]
    || env["DOCUMENT_INTAKE_ENABLED"] === "true") throw new QueueError("invalid");
  return { scope, runtime, roleArn, region: "us-east-2" };
}
function queueUrl(scope: JobScope, queue: JobQueue) { return `https://sqs.us-east-2.amazonaws.com/792394000571/pellum-${scope}-${queue}`; }
function client(config: QueueConfig): SQSClient {
  if (!["stg", "preview"].includes(config.scope) || !["dispatcher", "pipeline-worker", "notifications-worker"].includes(config.runtime)
    || config.region !== "us-east-2" || config.roleArn !== `arn:aws:iam::792394000571:role/pellum-${config.scope}-job-${config.runtime}`) throw new QueueError("invalid");
  const credentials = awsCredentialsProvider({ roleArn: config.roleArn, durationSeconds: 900,
    clientConfig: { region: config.region, maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } } });
  return new SQSClient({ region: config.region, credentials, maxAttempts: 1,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: budget.receiveTimeoutMs } });
}
/** Only the dispatcher receives a send-capable role. Attributes/metadata cannot be supplied. */
export class SqsJobSender implements JobTransport {
  private readonly sqs: SQSClient;
  constructor(private readonly config: QueueConfig) {
    if (config.runtime !== "dispatcher") throw new QueueError("invalid");
    this.sqs = client(config);
  }
  async send(queue: JobQueue, body: string, signal: AbortSignal): Promise<void> {
    let envelope: JobEnvelope;
    try { envelope = decodeJobEnvelope(body); } catch { throw new QueueError("invalid"); }
    if (jobQueue(envelope.consumer) !== queue) throw new QueueError("invalid");
    try {
      await this.sqs.send(new SendMessageCommand({ QueueUrl: queueUrl(this.config.scope, queue), MessageBody: encodeJobEnvelope(envelope) }), { abortSignal: signal });
    } catch { throw new QueueError("unavailable"); }
  }
  close(): void { this.sqs.destroy(); }
}
export interface ReceivedJob {
  readonly body: string;
  readonly receiveCount: number;
  readonly sentAt: number;
}
interface Lease { handle: string; receivedAt: number; expiresAt: number; maximumUntil: number; extensions: number }
/** Receipt handles are bearer capabilities. A WeakMap keeps them out of serialization/logs. */
export class SqsJobReceiver {
  private readonly sqs: SQSClient;
  private readonly leases = new WeakMap<ReceivedJob, Lease>();
  readonly scope: JobScope;
  readonly queue: JobQueue;
  constructor(config: QueueConfig) {
    if (config.runtime === "dispatcher") throw new QueueError("invalid");
    this.scope = config.scope; this.queue = config.runtime === "pipeline-worker" ? "pipeline" : "notifications";
    this.sqs = client(config);
  }
  async receive(): Promise<ReceivedJob | null> {
    const receivedAt = Date.now();
    let response;
    try {
      response = await this.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl(this.scope, this.queue),
        MaxNumberOfMessages: budget.maxConcurrentMessages, WaitTimeSeconds: budget.longPollSeconds,
        VisibilityTimeout: budget.visibilitySeconds, MessageAttributeNames: ["All"],
        MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"],
      }), { abortSignal: AbortSignal.timeout(budget.receiveTimeoutMs) });
    } catch { throw new QueueError("unavailable"); }
    const messages = response.Messages ?? [];
    if (!messages.length) return null;
    const m = messages[0];
    if (messages.length !== 1 || !m?.Body || !m.ReceiptHandle || Object.keys(m.MessageAttributes ?? {}).length) throw new QueueError("invalid");
    let envelope: JobEnvelope;
    try { envelope = decodeJobEnvelope(m.Body); } catch { throw new QueueError("invalid"); }
    const receiveCount = Number(m.Attributes?.ApproximateReceiveCount), sentAt = Number(m.Attributes?.SentTimestamp);
    if (!Number.isSafeInteger(receiveCount) || receiveCount < 1 || !Number.isSafeInteger(sentAt) || sentAt < 1
      || sentAt > Date.now() + 60_000 || jobQueue(envelope.consumer) !== this.queue) throw new QueueError("invalid");
    const job = Object.freeze({ body: encodeJobEnvelope(envelope), receiveCount, sentAt });
    // Start before the network response: deliberately conservative about the remaining lease.
    this.leases.set(job, { handle: m.ReceiptHandle, receivedAt, expiresAt: receivedAt + budget.visibilitySeconds * 1_000,
      maximumUntil: receivedAt + budget.maxVisibilityLifetimeSeconds * 1_000, extensions: 0 });
    return job;
  }
  private lease(job: ReceivedJob): Lease {
    const value = this.leases.get(job);
    if (!value || Date.now() >= value.expiresAt) throw new QueueError("lease-expired");
    return value;
  }
  async acknowledge(job: ReceivedJob): Promise<void> {
    const lease = this.lease(job);
    try {
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl(this.scope, this.queue), ReceiptHandle: lease.handle }),
        { abortSignal: AbortSignal.timeout(budget.acknowledgementTimeoutMs) });
      this.leases.delete(job);
    } catch { throw new QueueError("unavailable"); }
  }
  async extend(job: ReceivedJob): Promise<void> {
    const lease = this.lease(job), now = Date.now();
    if (lease.extensions >= budget.maxVisibilityExtensions) throw new QueueError("lease-expired");
    const seconds = Math.min(budget.visibilitySeconds, Math.floor((lease.maximumUntil - now - budget.acknowledgementTimeoutMs) / 1_000));
    if (seconds <= 0 || now + seconds * 1_000 <= lease.expiresAt) throw new QueueError("lease-expired");
    // Reserve before I/O: an ambiguous timeout must not authorize another extension.
    lease.extensions++;
    try {
      await this.sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl(this.scope, this.queue), ReceiptHandle: lease.handle, VisibilityTimeout: seconds }),
        { abortSignal: AbortSignal.timeout(budget.acknowledgementTimeoutMs) });
      lease.expiresAt = now + seconds * 1_000;
    } catch { throw new QueueError("unavailable"); }
  }
  close(): void { this.sqs.destroy(); }
}
