import { ProblemDetailsSchema, type ProblemDetails } from "@autobureau/contracts";
import { CSRF_HEADER, CSRF_HEADER_VALUE, isSafeMethod } from "./csrf";

/**
 * The single HTTP door to `/v1` (ADR-008, doc 03).
 *
 * Everything the UI knows about the server passes through here, which buys three
 * things at once: every error arrives as a typed ProblemDetails instead of an
 * arbitrary throw; the household header is attached in exactly one place, so a
 * screen cannot accidentally query without tenant scope; and idempotency keys are
 * generated for unsafe methods automatically, so a double-tapped button on a flaky
 * train connection cannot create two obligations.
 */

export class ApiError extends Error {
  readonly problem: ProblemDetails;
  readonly status: number;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.problem = problem;
    this.status = problem.status;
  }

  /** Field-level messages for form binding, keyed by path. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.problem.errors ?? []) out[e.path] = e.message;
    return out;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  get isCapExceeded(): boolean {
    return this.status === 402;
  }
}

const GENERIC_PROBLEM: ProblemDetails = {
  type: "https://autobureau.com/problems/internal",
  title: "Something went wrong",
  status: 500,
  detail: "We couldn't complete that. Please try again in a moment.",
};

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  householdId?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Supply to make a retry provably safe; generated automatically when omitted. */
  idempotencyKey?: string | undefined;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The household this client names on requests, or `null` when naming one is unnecessary
 * (blueprint P1-03).
 *
 * THIS IS THE SERVER'S ANSWER, NOT THE BROWSER'S PREFERENCE. `HouseholdProvider`
 * publishes it, and what the provider holds came out of `resolveRequestContext` during
 * the server render — so the value echoed back here is one the server has already
 * validated against membership. The selection *cookie* is what the browser gets to
 * choose; this is what the server made of it.
 *
 * Module-level rather than threaded through every call because `apiFetch` is the single
 * door to `/v1` and the header has exactly one attach point below. The alternative —
 * every `queries.ts` hook passing `householdId` — is the duplication this file's own
 * header warns against ("so a screen cannot accidentally query without tenant scope").
 */
let activeHouseholdId: string | null = null;

/**
 * Publish the active household. Called by `HouseholdProvider` and nowhere else.
 *
 * `null` means "no selection is required" — a principal with exactly one membership.
 * That case sends no header at all, so a single-household request is byte-identical to
 * what it was before P1-03, and `resolveRequestContext` resolves the sole membership by
 * the same path it always did.
 */
export function setActiveHousehold(householdId: string | null): void {
  activeHouseholdId = householdId;
}

/** Test seam: module state would otherwise leak between cases. */
export function resetActiveHousehold(): void {
  activeHouseholdId = null;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, householdId, signal, idempotencyKey } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // An explicit option still wins — it is what the type has always offered — but the
  // published selection is the default, so no call site has to remember.
  const scope = householdId ?? activeHouseholdId;
  if (scope) headers["X-Household-Id"] = scope;
  // ADR-009 D4: unconditional on every unsafe method, DELETE included. Idempotency-Key
  // below is deliberately NOT the CSRF signal — it is semantic, and it is skipped for
  // DELETE, which would have left the destructive method the only unprotected one.
  if (!isSafeMethod(method)) headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  if (method !== "GET" && method !== "DELETE") {
    headers["Idempotency-Key"] = idempotencyKey ?? newIdempotencyKey();
  }

  let response: Response;
  try {
    response = await fetch(`/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError({
      type: "https://autobureau.com/problems/unavailable",
      title: "Can't reach AutoBureau",
      status: 503,
      detail: "Check your connection — we'll retry automatically.",
    });
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("content-type")?.includes("json") ?? false;
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const parsed = ProblemDetailsSchema.safeParse(payload);
    throw new ApiError(parsed.success ? parsed.data : { ...GENERIC_PROBLEM, status: response.status });
  }

  return payload as T;
}
