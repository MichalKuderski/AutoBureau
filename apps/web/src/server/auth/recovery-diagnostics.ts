import { AsyncLocalStorage } from "node:async_hooks";
import { uuidv7 } from "@autobureau/contracts";
import { log, withTraceHeader } from "../observability";
import { ProviderError, providerFailureMeta } from "./provider";
import { TokenError, VerificationUnavailableError } from "./jwt";

/** Internal phase names only. No claims, identifiers, request data or raw errors. */
export type RecoveryPhase = "mount_gate" | "request_validation" | "request_rate_limit" | "password_policy"
  | "redemption" | "jwt_validation" | "membership_read" | "owner_selection" | "assurance_check"
  | "user_rate_limit" | "db_admission" | "factor_read" | "mfa_challenge" | "mfa_verification"
  | "factor_recheck" | "authorization" | "audit_attempt" | "password_update" | "audit_update"
  | "revocation" | "audit_revocation";
type MutationOutcome = "not_attempted" | "unconfirmed" | "acknowledged";
interface Diagnostic {
  reference: string;
  phase: RecoveryPhase;
  outcome: MutationOutcome;
  failure?: Record<string, unknown>;
}
const context = new AsyncLocalStorage<Diagnostic>();
export function recoveryPhase(phase: RecoveryPhase): void {
  const current = context.getStore(); if (current) current.phase = phase;
}
export function recoveryMutation(outcome: MutationOutcome): void {
  const current = context.getStore(); if (current) current.outcome = outcome;
}
export function recoveryReference(): string | undefined { return context.getStore()?.reference; }

/** Do not pass Error to the general logger: even its message/stack can contain secrets. */
export function recoveryFailure(cause: unknown): void {
  const current = context.getStore(); if (!current) return;
  let failure: Record<string, unknown> = { category: "refused" };
  try {
    if (cause instanceof ProviderError) {
      failure = { category: "provider", ...providerFailureMeta(cause) };
      if (["invalid-credentials", "invalid-refresh", "invalid-code", "rate-limited", "unavailable"].includes(cause.reason)) failure.code = cause.reason;
    } else if (cause instanceof TokenError) {
      failure = { category: "identity" };
      if (["malformed", "signature", "expired", "issuer", "audience", "algorithm", "claims"].includes(cause.reason)) failure.code = cause.reason;
    } else if (cause instanceof VerificationUnavailableError) {
      failure = { category: "identity", code: "key-service-unavailable" };
    } else if (typeof cause === "object" && cause !== null) {
      // Inspect a data property only; never execute an error object's getter or stringify it.
      const code = Object.getOwnPropertyDescriptor(cause, "code")?.value;
      if (typeof code === "string" && /^P\d{4}$/.test(code)) failure = { category: "database", code };
    }
  } catch { failure = { category: "refused" }; }
  current.failure = failure;
}

/** Mount and controller share one scope/event; standalone controller tests get the same boundary. */
export async function withRecoveryDiagnostics(task: () => Promise<Response>): Promise<Response> {
  if (context.getStore()) return task();
  // Never echo the inbound x-request-id: a syntactically valid value could still be a secret.
  const diagnostic: Diagnostic = { reference: uuidv7(), phase: "request_validation", outcome: "not_attempted" };
  const started = performance.now();
  return context.run(diagnostic, async () => {
    const record = (status: number) => log({
      event: "auth.recovery_failed", level: "warn", traceId: diagnostic.reference,
      route: "/v1/auth/recovery/complete", status,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      meta: { phase: diagnostic.phase, mutation_outcome: diagnostic.outcome, ...(diagnostic.failure ?? { category: "refused" }) },
    });
    try {
      const response = await task();
      if (!response.ok) record(response.status);
      return withTraceHeader(response, diagnostic.reference);
    } catch (cause) {
      recoveryFailure(cause); record(500); throw cause;
    }
  });
}
