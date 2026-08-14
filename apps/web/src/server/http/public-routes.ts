/**
 * The public-route allowlist (ADR-009 D3).
 *
 * Deny-by-default means this list is the *entire* unauthenticated surface of the
 * application. It is an exact-match list with no prefixes and no patterns, because a
 * prefix quietly admits every path beneath it — `/auth/` would have made any future
 * `/auth/anything` public without anyone deciding to. Adding an entry here is a visible,
 * reviewable act, and a test pins the list so an addition cannot pass unnoticed.
 */

/** D3 verbatim: the pages a signed-out person is meant to reach. */
const PUBLIC_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password"] as const;

/**
 * The endpoints that establish or repair a session.
 *
 * These are not in D3's prose, and they are not an expansion of it — they are entailed
 * by it. A sign-in endpoint that required a session could never be reached; a refresh
 * endpoint behind the gate would be redirected to itself. Sign-out is public so that a
 * user with an expired access token can still clear their cookies.
 */
const PUBLIC_AUTH_ENDPOINTS = [
  "/v1/auth/sign-in",
  "/v1/auth/sign-out",
  "/v1/auth/magic-link",
  "/auth/refresh",
  // Reached by following an emailed link, i.e. always without a session. It carries an
  // authorization code that is inert without the verifier cookie, so being public costs
  // nothing: the code alone authenticates no one.
  "/auth/callback",
] as const;

export const PUBLIC_PATHS: readonly string[] = [...PUBLIC_PAGES, ...PUBLIC_AUTH_ENDPOINTS];

/** The path `/auth/refresh` redirects to when it cannot repair the session. */
export const SIGN_IN_PATH = "/sign-in";

/** Where a successful refresh goes when `next` is missing or refused. */
export const DEFAULT_DESTINATION = "/dashboard";

export function isPublicPath(pathname: string): boolean {
  // Trailing slashes are normalised so `/sign-in/` cannot slip past an exact match, and
  // so `/sign-in/../dashboard` style inputs never reach the comparison as something else.
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.includes(normalised);
}

/**
 * Same-origin destination validation — the open-redirect guard.
 *
 * Accepts only a path on this origin. Rejected: absolute URLs, protocol-relative `//evil`,
 * backslash variants that some parsers normalise to `//`, anything with a control
 * character, and `/auth/refresh` itself, which is the loop the redirect exists to avoid.
 */
export function safeDestination(raw: string | null): string {
  if (raw === null || raw === "") return DEFAULT_DESTINATION;
  if (!raw.startsWith("/")) return DEFAULT_DESTINATION;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_DESTINATION;
  if (raw.includes("\\")) return DEFAULT_DESTINATION;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_DESTINATION;

  const path = raw.split("?")[0]?.split("#")[0] ?? "";
  const normalised = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (normalised === "/auth/refresh") return DEFAULT_DESTINATION;

  return raw;
}
