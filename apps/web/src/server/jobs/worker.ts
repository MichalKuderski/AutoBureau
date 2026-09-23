import { consumeDelivery, type Database, type JobHandlers } from "@autobureau/db";
import { uuidv7, JOB_EXECUTION_BUDGET, type JobQueue, type JobScope } from "@autobureau/contracts";
import { log } from "@/server/observability";
import { SqsJobReceiver, type ReceivedJob } from "./sqs";

export const JOB_METRICS = ["received", "send_failure", "processing_failure", "retry", "exhausted", "completed", "duplicate", "refused", "delivery_lag_ms", "reconciliation_mismatch"] as const;
export type JobMetric = typeof JOB_METRICS[number];
export function jobMetric(metric: JobMetric, scope: JobScope, queue: JobQueue, value = 1): void {
  if (!JOB_METRICS.includes(metric) || !["stg", "preview"].includes(scope) || !["pipeline", "notifications"].includes(queue)
    || !Number.isSafeInteger(value) || value < 0 || value > 1_209_600_000) throw new Error("Invalid job metric");
  log({ traceId: uuidv7(), event: `jobs.${metric}`, level: ["send_failure", "processing_failure", "exhausted", "reconciliation_mismatch"].includes(metric) ? "error" : "info",
    meta: { job_scope: scope, job_queue: queue, value } });
}
/** One bounded receive, one DB-only effect and one acknowledgement. There is no polling loop.
 * Invocation/scheduling, scanner processes and provider delivery remain independently gated. */
export async function runJobOnce(db: Database, receiver: SqsJobReceiver, handlers: JobHandlers, metrics?: { record(metric: JobMetric, value?: number): void }): Promise<"idle" | "completed" | "duplicate" | "refused" | "retry" | "exhausted"> {
  const record = (metric: JobMetric, value = 1) => metrics ? metrics.record(metric, value) : jobMetric(metric, receiver.scope, receiver.queue, value);
  let job: ReceivedJob | null;
  try { job = await receiver.receive(); } catch {
    record("processing_failure"); return "retry";
  }
  if (!job) return "idle";
  record("received");
  record("delivery_lag_ms", Math.max(0, Date.now() - job.sentAt));
  if (job.receiveCount > JOB_EXECUTION_BUDGET.maxReceives) {
    record("exhausted"); return "exhausted";
  }
  try {
    const result = await consumeDelivery(db, receiver.scope, receiver.queue, job.body, handlers);
    record(result);
    if (result === "refused") return result;
    await receiver.acknowledge(job);
    return result;
  } catch {
    // No upstream body, URL, receipt handle, tenant ID or handler error is logged.
    record("processing_failure");
    const result = job.receiveCount >= JOB_EXECUTION_BUDGET.maxReceives ? "exhausted" : "retry";
    record(result);
    return result;
  }
}
