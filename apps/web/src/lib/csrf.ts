/**
 * The CSRF signal, shared by both ends (ADR-009 D4).
 *
 * Only the constants and the method classification live here, because both the browser
 * (which must attach the header) and the server (which must require it) need to agree on
 * them. The enforcement itself is server-side, in `server/http/csrf.ts`.
 */

/** Lowercase; `Headers.get` is case-insensitive but the constant is compared directly. */
export const CSRF_HEADER = "x-autobureau-request";

/** Presence is the signal. The value exists only so the header is never empty. */
export const CSRF_HEADER_VALUE = "1";

/** RFC 9110 safe methods: no state change, so no CSRF surface. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}
