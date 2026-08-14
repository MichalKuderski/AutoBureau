import type { AuthConfig } from "./config";

/**
 * Session cookies (ADR-009 D2, doc 06 §1).
 *
 * Every attribute below is load-bearing:
 *
 *   HttpOnly  — the whole reason the session is established server-side. A browser SDK
 *               cannot set this, which is why D2 supersedes ADR-002 ¶1.
 *   Secure    — unconditional, including in development. A flag that is sometimes absent
 *               is a flag nobody can reason about, and the auth flow needs a provider
 *               anyway, so there is no plaintext-localhost case to accommodate.
 *   SameSite=Lax — doc 06 §1. `Strict` would break magic-link and OAuth returns, which
 *               are top-level cross-site navigations that must carry the session.
 *   Path=/    — the access cookie is read on every route; scoping the refresh cookie
 *               more narrowly would stop middleware seeing that a session is refreshable.
 *
 * Tokens live here and nowhere else: never in a response body, never in a URL, never in
 * `localStorage` or `sessionStorage`. That is asserted by the A3 tests.
 */

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires, as reported by the provider. */
  readonly expiresIn: number;
}

/**
 * How long the refresh cookie outlives the access token. The provider decides when a
 * refresh token actually stops working; this only decides when the browser stops
 * offering it, and a value shorter than the provider's would log people out early.
 */
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function serialize(
  name: string,
  value: string,
  options: { maxAge: number },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ].join("; ");
}

/** `Set-Cookie` values establishing a session. Returned as a list; callers append them. */
export function sessionCookies(config: AuthConfig, tokens: SessionTokens): string[] {
  return [
    serialize(config.cookieName, tokens.accessToken, { maxAge: tokens.expiresIn }),
    serialize(config.refreshCookieName, tokens.refreshToken, {
      maxAge: REFRESH_MAX_AGE_SECONDS,
    }),
  ];
}

/**
 * `Set-Cookie` values clearing a session.
 *
 * Both cookies, always, even when only one looked present. A cleared access cookie
 * beside a surviving refresh cookie is a half-session: middleware would keep redirecting
 * to refresh, and the refresh route would keep failing. Clearing both is also what makes
 * the refresh loop terminate without middleware having to mutate anything.
 */
export function clearedSessionCookies(config: AuthConfig): string[] {
  return [
    serialize(config.cookieName, "", { maxAge: 0 }),
    serialize(config.refreshCookieName, "", { maxAge: 0 }),
  ];
}

export function appendCookies(response: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}
