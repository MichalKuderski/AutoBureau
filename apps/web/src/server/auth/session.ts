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
  options: { maxAge: number; path?: string },
): string {
  return [
    `${name}=${value}`,
    `Path=${options.path ?? "/"}`,
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

/**
 * The refresh cooldown marker (blueprint P1-07).
 *
 * WHAT IT IS FOR, AND WHAT IT DELIBERATELY IS NOT
 * -----------------------------------------------
 * When the identity provider is unreachable, `/auth/refresh` must not destroy a session
 * that has not been proven invalid — but retaining the refresh cookie also retains the
 * condition middleware redirects on. The termination guarantee comes from the route
 * answering `503` instead of redirecting (a response that redirects nowhere cannot loop).
 * This marker does the second, smaller job: once it exists, it suppresses further outbound
 * attempts for its lifetime, so a browser that keeps asking during an outage stops
 * costing a provider call each time.
 *
 * WHAT IT DOES NOT DO: it is not a lock. It is read from the request and written to the
 * response, with the provider call in between, so requests that arrive before the first
 * response carries it back will each see no marker and each attempt once. Under arbitrary
 * concurrency the bound is therefore "one attempt per in-flight request, then none until
 * expiry" — not "exactly one, ever". Making it exactly-one would take shared state this
 * architecture does not have, and the blueprint rules that out here; the attempts are
 * already bounded by P1-06's per-call timeout and by the marker closing the window
 * immediately afterwards.
 *
 * IT IS NOT A CREDENTIAL. The value is a constant. It carries no token, no user, no
 * household, and no authorization of any kind, and nothing anywhere reads it to decide
 * whether a request is authenticated — `exp` on the JWT remains the sole authority.
 * A forged marker can only make `/auth/refresh` answer `503` without calling the provider
 * for a few seconds, which denies a refresh rather than granting anything; it fails safe.
 *
 * `Path=/auth/refresh` on purpose: the only reader is that route, so the marker is never
 * transmitted on ordinary requests and cannot become ambient request state. It expires on
 * its own, and a successful refresh clears it so a later legitimate attempt is never
 * blocked by a stale one.
 */
const REFRESH_COOLDOWN_SECONDS = 15;
const REFRESH_COOLDOWN_PATH = "/auth/refresh";

export function refreshCooldownCookieName(config: AuthConfig): string {
  return `${config.cookieName}_retry`;
}

export function refreshCooldownCookie(config: AuthConfig): string {
  return serialize(refreshCooldownCookieName(config), "1", {
    maxAge: REFRESH_COOLDOWN_SECONDS,
    path: REFRESH_COOLDOWN_PATH,
  });
}

export function clearedRefreshCooldownCookie(config: AuthConfig): string {
  return serialize(refreshCooldownCookieName(config), "", {
    maxAge: 0,
    path: REFRESH_COOLDOWN_PATH,
  });
}
