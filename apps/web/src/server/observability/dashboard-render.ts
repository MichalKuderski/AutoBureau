import { AsyncLocalStorage } from "node:async_hooks";
import { uuidv7 } from "@autobureau/contracts";
import type { TransactionTiming } from "@autobureau/db";
import { log } from "./logger";

export type DashboardPhase = "resolve" | "configuration" | "context" | "context_fallback"
  | "identity_verify" | "memberships" | "household_options" | "option_read"
  | "shell_session" | "shell_read" | "admission_before" | "provider_factors"
  | "admission_after_factors" | "session_task" | "admission_after_task";
type Budget = { emitted: number; dropped: number; failure?: { cause: unknown; phase: DashboardPhase } };
const context = new AsyncLocalStorage<{ traceId: string; phases: DashboardPhase[]; budget: Budget }>();
const ms = (value: number) => Math.min(600_000, Math.max(0, Math.round(value)));
function codeOf(cause: unknown): string | undefined {
  try {
    const code = cause && typeof cause === "object" ? Object.getOwnPropertyDescriptor(cause, "code")?.value : undefined;
    return typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
  } catch { return undefined; }
}
function emit(event: string, meta: Record<string, unknown>, failed = false, terminal = false): void {
  const state = context.getStore();
  if (!state) return;
  if (!terminal && state.budget.emitted >= 96) { state.budget.dropped = Math.min(1000, state.budget.dropped + 1); return; }
  if (!terminal) state.budget.emitted++;
  // Constructed fixed fields only: no errors, results, headers, claims or identifiers.
  log({ event, traceId: state.traceId, route: "/dashboard", method: "GET", level: failed ? "warn" : "info", meta });
}

/** Covers only the awaited layout resolver, not React's later client rendering. */
export async function withDashboardRender<T>(enabled: boolean, task: () => Promise<T>): Promise<T> {
  if (!enabled) return task();
  return context.run({ traceId: uuidv7(), phases: [], budget: { emitted: 0, dropped: 0 } }, async () => {
    const start = performance.now();
    let outcome = "success", code: string | undefined, failurePhase: DashboardPhase | undefined;
    try { return await dashboardPhase("resolve", task); }
    catch (cause) {
      outcome = "failure"; code = codeOf(cause);
      failurePhase = context.getStore()!.budget.failure?.phase;
      throw cause;
    } finally {
      emit("dashboard.render_complete", { outcome, duration_ms: ms(performance.now() - start),
        dropped: context.getStore()!.budget.dropped, ...(failurePhase ? { failure_phase: failurePhase } : {}),
        ...(code ? { code } : {}) }, outcome === "failure", true);
    }
  });
}

/** No-op outside dashboard-render context. Nested labels identify admission vs data work. */
export async function dashboardPhase<T>(phase: DashboardPhase, task: () => Promise<T>): Promise<T> {
  const state = context.getStore();
  if (!state) return task();
  return context.run({ ...state, phases: [...state.phases, phase].slice(-8) }, async () => {
    const start = performance.now(); let failed = false, code: string | undefined;
    try { return await task(); }
    catch (cause) {
      failed = true; code = codeOf(cause);
      if (state.budget.failure?.cause !== cause) state.budget.failure = { cause, phase };
      throw cause;
    } finally {
      emit("dashboard.render_phase", { phases: context.getStore()!.phases, outcome: failed ? "failure" : "success",
        duration_ms: ms(performance.now() - start), ...(code ? { code } : {}) }, failed);
    }
  });
}

export function observeDashboardTransaction(event: TransactionTiming): void {
  const state = context.getStore();
  if (!state) return;
  emit("dashboard.render_transaction", { phases: state.phases, operation: event.operation, outcome: event.outcome,
    acquisition_ms: event.acquisition_ms, execution_ms: event.execution_ms,
    waiting_at_start: event.waiting_at_start, active_at_start: event.active_at_start,
    ...(event.code ? { code: event.code } : {}) }, event.outcome !== "success");
}

/** A resolved redirect/chooser is not a successfully rendered household dashboard. */
export function dashboardResolution(kind: "ready" | "choose" | "onboarding" | "sign-in"): void {
  emit("dashboard.render_resolution", { resolution: kind });
}
