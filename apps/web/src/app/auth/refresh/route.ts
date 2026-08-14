import { authConfigFromEnv } from "@/server/auth/config";
import { readCookie } from "@/server/auth/context";
import { createGoTrueProvider } from "@/server/auth/provider";
import { appendCookies, clearedSessionCookies, sessionCookies } from "@/server/auth/session";
import { SIGN_IN_PATH, safeDestination } from "@/server/http/public-routes";

/**
 * `GET /auth/refresh?next=…` — rotate the session and continue (ADR-009 D3).
 *
 * This route exists because D3 forbids middleware from mutating session state. Rotation
 * is mutation, so it happens here, and middleware only points at it. The extra redirect
 * is the accepted price of not amending frozen governance.
 *
 * It is a `GET` because it is reached by navigation, not by script — `SameSite=Lax`
 * sends the session on a top-level GET and nothing else would work. That does mean a
 * hostile page can navigate someone here and cause a rotation; the consequence is a
 * rotated token and a redirect to a validated same-origin path, which is a nuisance
 * rather than a compromise. No CSRF header is required because no browser would send one
 * on a navigation.
 *
 * THE LOOP GUARD IS STRUCTURAL. On failure this clears *both* cookies. Middleware only
 * redirects here when a refresh cookie exists, so a failed refresh removes the trigger
 * and the next pass goes to sign-in instead. Nothing counts attempts, and middleware
 * stays free of state. `next` is validated to a same-origin path that is never this
 * route, so a success cannot bounce back here either.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const destination = safeDestination(url.searchParams.get("next"));

  let config;
  try {
    config = authConfigFromEnv();
  } catch {
    return Response.redirect(new URL(SIGN_IN_PATH, url.origin), 303);
  }

  const abandon = (): Response =>
    appendCookies(
      new Response(null, {
        status: 303,
        headers: { location: new URL(SIGN_IN_PATH, url.origin).toString(), "cache-control": "no-store" },
      }),
      clearedSessionCookies(config),
    );

  const refreshToken = readCookie(request.headers.get("cookie"), config.refreshCookieName);
  if (refreshToken === null) return abandon();

  try {
    const tokens = await createGoTrueProvider(config).refresh(refreshToken);
    return appendCookies(
      new Response(null, {
        status: 303,
        headers: {
          location: new URL(destination, url.origin).toString(),
          "cache-control": "no-store",
        },
      }),
      sessionCookies(config, tokens),
    );
  } catch {
    // Rotated, revoked, expired, or the provider is down — all end the session here
    // rather than leaving a half-session that would loop.
    return abandon();
  }
}

export const dynamic = "force-dynamic";
