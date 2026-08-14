/**
 * CSRF enforcement (ADR-009 D4).
 *
 * Doc 12 §4 requires "same-site-cookie + custom-header checked" on all state-changing
 * routes. The cookie half is set by the session transport; this is the header half.
 *
 * Two things D4 explicitly rejected, and why they are not here:
 *
 *   No synchronizer token. With `SameSite=Lax` cookies, `credentials: "same-origin"`,
 *   and no CORS allowlist, a cross-site attacker can neither set a custom header from an
 *   HTML form nor survive preflight from `fetch`. A token would add server-side state
 *   for no additional property.
 *
 *   No overloading of `Idempotency-Key` or `X-Household-Id`. Both are semantic and both
 *   are conditional — `apiFetch` omits the former on DELETE — which would have left the
 *   destructive method as the only unprotected one. A CSRF signal has to be
 *   unconditional, so it gets a header of its own that means nothing else.
 */

import { CSRF_HEADER, isSafeMethod } from "@/lib/csrf";

export { CSRF_HEADER, CSRF_HEADER_VALUE, isSafeMethod } from "@/lib/csrf";

export type CsrfRejection = "missing-header" | "foreign-origin";

export class CsrfError extends Error {
  override readonly name = "CsrfError";
  constructor(
    readonly reason: CsrfRejection,
    message: string,
  ) {
    super(message);
  }
}

export interface CsrfOptions {
  /** Origins this deployment answers on. An `Origin` outside this set is rejected. */
  readonly allowedOrigins: readonly string[];
}

/**
 * Throws `CsrfError` when a state-changing request cannot be shown to be same-site.
 * Safe methods pass untouched.
 */
export function assertSameSiteRequest(request: Request, options: CsrfOptions): void {
  if (isSafeMethod(request.method)) return;

  // Checked before the header, because a cross-origin request that somehow carried the
  // header should still be rejected on the stronger signal.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "" && origin !== "null") {
    if (!options.allowedOrigins.includes(origin)) {
      throw new CsrfError("foreign-origin", "request origin is not this deployment");
    }
  }

  const header = request.headers.get(CSRF_HEADER);
  if (header === null || header.trim() === "") {
    throw new CsrfError(
      "missing-header",
      `${request.method} requests must carry the ${CSRF_HEADER} header`,
    );
  }
}
