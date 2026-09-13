import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import type { JobQueue, JobScope } from "@autobureau/contracts";
import { JOB_METRICS, jobMetric, type JobMetric } from "./worker";
import { QueueError, type QueueConfig } from "./sqs";

/** Fixed namespaces/dimensions prevent tenant or receipt data from becoming metric metadata. */
export class JobMetricBatch {
  private readonly counts = new Map<JobMetric, number>();
  private readonly client: CloudWatchClient;
  readonly scope: JobScope;
  constructor(config: QueueConfig, private readonly queue: JobQueue) {
    if (!["stg", "preview"].includes(config.scope) || !["pipeline", "notifications"].includes(queue)
      || config.region !== "us-east-2" || !["dispatcher", `${queue}-worker`].includes(config.runtime)
      || config.roleArn !== `arn:aws:iam::792394000571:role/pellum-${config.scope}-job-${config.runtime}`) throw new QueueError("invalid");
    this.scope = config.scope;
    const credentials = awsCredentialsProvider({ roleArn: config.roleArn, durationSeconds: 900,
      clientConfig: { region: "us-east-2", maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } } });
    this.client = new CloudWatchClient({ region: "us-east-2", credentials, maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } });
  }
  record(metric: JobMetric, value = 1): void {
    if (!JOB_METRICS.includes(metric) || !Number.isSafeInteger(value) || value < 0 || value > 1_209_600_000) throw new QueueError("invalid");
    const total = metric === "delivery_lag_ms" ? Math.max(this.counts.get(metric) ?? 0, value) : (this.counts.get(metric) ?? 0) + value;
    if (!Number.isSafeInteger(total) || total > 1_209_600_000) throw new QueueError("invalid");
    this.counts.set(metric, total);
    jobMetric(metric, this.scope, this.queue, value);
  }
  async flush(): Promise<void> {
    if (!this.counts.size) return;
    const snapshot = new Map(this.counts);
    this.counts.clear();
    try {
      await this.client.send(new PutMetricDataCommand({ Namespace: `Pellum/StagingJobs/${this.scope}/${this.queue}`,
        MetricData: [...snapshot].map(([MetricName, Value]) => ({ MetricName, Value, Unit: MetricName === "delivery_lag_ms" ? "Milliseconds" : "Count" })),
      }), { abortSignal: AbortSignal.timeout(10_000) });
    } catch {
      // No automatic replay after an ambiguous publish: metrics are advisory, DB is authority.
      throw new QueueError("unavailable");
    }
  }
  close(): void { this.client.destroy(); }
}
