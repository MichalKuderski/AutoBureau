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
 *
 * COOKIE LIFETIME IS NOT CREDENTIAL LIFETIME
 * ------------------------------------------
 * Both cookies carry the *session's* `Max-Age`, not the access token's. The JWT's `exp`
 * remains the sole authority boundary: it is verified on every request, with zero clock
 * tolerance, by middleware and by the `/v1` boundary alike. A cookie that outlives its
 * token therefore confers nothing — it is an envelope, not a credential.
 *
 * Scoping the access cookie to `expires_in` looked tidier and was a defect. A browser
 * deletes a cookie the moment its `Max-Age` lapses, so the state D3's refresh redirect
 * exists to detect — an *expired token still present* — could never arise during normal
 * navigation. Middleware saw no cookie at all, denied at its first check, and never
 * reached the branch that offers the 30-day refresh token. Sessions therefore ended
 * roughly hourly at `/sign-in`, which is precisely what PRD §19 F1's "session refresh
 * invisible" forbids. The container must outlive the credential for the refresh path to
 * be reachable at all.
 */

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /**
   * Seconds until the access token expires, as reported by the provider.
   *
   * Deliberately *not* used as a cookie `Max-Age` — see the note above. It is retained
   * because the provider reports it and `TokenResponseSchema` requires it, which keeps
   * a malformed token response from being mistaken for a usable session.
   */
  readonly expiresIn: number;
}

/**
 * How long the browser keeps offering this session, for both cookies.
 *
 * The provider decides when a refresh token actually stops working; this only decides
 * when the browser stops offering it, and a value shorter than the provider's would log
 * people out early. The access cookie shares it so that an expired access token stays
 * present to be *recognised* as expired — which is the only way middleware can route
 * through `/auth/refresh` instead of `/sign-in`.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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
    serialize(config.cookieName, tokens.accessToken, { maxAge: SESSION_MAX_AGE_SECONDS }),
    serialize(config.refreshCookieName, tokens.refreshToken, {
      maxAge: SESSION_MAX_AGE_SECONDS,
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
