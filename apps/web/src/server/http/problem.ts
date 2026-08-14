import { problem, type ProblemKind } from "@autobureau/contracts";

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
  init: { detail?: string; instance?: string } = {},
): Response {
  const body = problem(kind, init);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: {
      "content-type": "application/problem+json",
      // An error page is never a cache entry, and a 403 cached for the wrong principal
      // is a data leak rather than a performance win.
      "cache-control": "no-store",
    },
  });
}

/** Success responses carry the same no-store rule: every `/v1` body is household data. */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
