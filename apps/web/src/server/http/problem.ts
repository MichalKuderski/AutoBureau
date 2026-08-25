import { problem, type FieldError, type ProblemKind } from "@autobureau/contracts";
import type { ZodError } from "zod";

/**
 * RFC 9457 responses (doc 03 §1) — the only error shape `/v1` returns.
 *
 * `detail` is caller-supplied and deliberately coarse at this boundary. An auth error
 * that explains precisely which check failed is an oracle, so the boundary maps every
 * token failure to one outcome and never distinguishes "that household is not yours"
 * from "no such household".
 */
export function problemResponse(
  kind: ProblemKind,
  init: {
    detail?: string;
    instance?: string;
    errors?: FieldError[];
    /**
     * Extra response headers (ADR-013 D10). Additive and optional: every existing caller
     * omits it and is unchanged. It exists because doc 03 §1 requires `Retry-After` on a
     * `429`, and there was previously no way for a problem response to carry one.
     *
     * `content-type` and `cache-control` are applied afterwards and cannot be overridden —
     * a problem response that became cacheable, or stopped being problem+json, would be a
     * contract break dressed as a header.
     */
    headers?: Record<string, string>;
  } = {},
): Response {
  const { headers, ...problemInit } = init;
  const body = problem(kind, problemInit);
  const response = new Response(JSON.stringify(body), { status: body.status });
  for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
  response.headers.set("content-type", "application/problem+json");
  // An error page is never a cache entry, and a 403 cached for the wrong principal
  // is a data leak rather than a performance win.
  response.headers.set("cache-control", "no-store");
  return response;
}

/** Success responses carry the same no-store rule: every `/v1` body is household data. */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * A Zod failure as field errors a form can bind to (ADR-011).
 *
 * The path is the schema path joined the way a client would address it —
 * `contacts[0].email` rather than `["contacts", 0, "email"]` — so a UI maps an error to
 * an input without parsing prose. A failure at the root (a body that is not an object at
 * all) reports an empty path, which is the one case a client renders as a form-level
 * message.
 *
 * Zod's own messages are safe to surface: they describe the *schema*, not the data, so
 * they carry nothing from the row being written. Anything richer would risk echoing a
 * value back, which in this product is how a passport number ends up in a log.
 */
export function fieldErrorsFrom(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path
      .map((segment, index) =>
        typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
      )
      .join(""),
    message: issue.message,
  }));
}

/** The canonical 400 for a body or query that did not match its schema. */
export function validationProblem(error: ZodError, detail?: string): Response {
  return problemResponse("validation", {
    ...(detail === undefined ? {} : { detail }),
    errors: fieldErrorsFrom(error),
  });
}
