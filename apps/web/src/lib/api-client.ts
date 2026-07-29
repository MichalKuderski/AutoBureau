import { ProblemDetailsSchema, type ProblemDetails } from "@autobureau/contracts";

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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, householdId, signal, idempotencyKey } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (householdId) headers["X-Household-Id"] = householdId;
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
