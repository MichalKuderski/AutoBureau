import { AsyncLocalStorage } from "node:async_hooks";
import type { TransactionTiming } from "@autobureau/db";
import { log } from "./logger";

const context = new AsyncLocalStorage<{ traceId: string; route: "/v1/dashboard" | "/v1/obligations"; emitted: number }>();
/** Fixed routes, server-generated correlation only. No request/tenant/SQL data. */
export function withReadTransactions<T>(method: string, route: string | undefined, traceId: string, task: () => Promise<T>): Promise<T> {
  if (method !== "GET" || (route !== "/v1/dashboard" && route !== "/v1/obligations")) return task();
  return context.run({ traceId, route, emitted: 0 }, task);
}
export function observeReadTransaction(event: TransactionTiming): void {
  const current = context.getStore();
  if (!current || current.emitted++ >= 16) return; // Hard per-request volume cap.
  log({ event: "db.read_transaction", level: event.outcome === "success" ? "info" : "warn",
    traceId: current.traceId, route: current.route, method: "GET", meta: { operation: event.operation, outcome: event.outcome, acquisition_ms: event.acquisition_ms,
      execution_ms: event.execution_ms, waiting_at_start: event.waiting_at_start, active_at_start: event.active_at_start,
      ...(event.code ? { code: event.code } : {}) } });
}
