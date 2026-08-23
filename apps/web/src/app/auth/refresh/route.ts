import { authConfigFromEnv } from "@/server/auth/config";
import { readCookie } from "@/server/auth/context";
import { createGoTrueProvider, ProviderError, type ProviderRejection } from "@/server/auth/provider";
import {
  appendCookies,
  clearedRefreshCooldownCookie,
  clearedSessionCookies,
  refreshCooldownCookie,
  refreshCooldownCookieName,
  sessionCookies,
} from "@/server/auth/session";
import { SIGN_IN_PATH, safeDestination } from "@/server/http/public-routes";
import { log, routeOf, traceIdFrom, withTraceHeader } from "@/server/observability";

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
 * THE LOOP GUARD, AND HOW P1-07 EXTENDS IT WITHOUT WEAKENING IT
 * -------------------------------------------------------------
 * The original guard is structural: middleware only redirects here when a refresh cookie
 * exists, and this route clears *both* cookies when it fails — so a failed refresh removes
 * the very condition that triggers the redirect, and the next pass falls through to
 * sign-in. Nothing counts attempts, and middleware stays free of state.
 *
 * That guard was paid for with a defect: clearing on *any* failure meant one transient
 * GoTrue 5xx signed out every active user at once. Not being able to reach the provider
 * is not evidence that a refresh token was revoked.
 *
 * The fix keeps the guard's shape by observing what actually makes a loop possible: a
 * loop needs a *redirect*. There are therefore exactly two terminating outcomes, and the
 * failure branches pick between them rather than sharing one:
 *
 *   definitive failure   clear both cookies, redirect to sign-in.
 *                        Terminates the old way: the redirect trigger is gone.
 *   transient failure    keep both cookies, redirect NOWHERE — answer 503.
 *                        Terminates because nothing follows a response that is not a
 *                        redirect. Middleware is never re-entered, so it cannot bounce
 *                        the request back here, and it needs no knowledge of any of this.
 *
 * `middleware.ts` is untouched by P1-07. The guard it documents still holds exactly as
 * written, because the branch that now retains cookies never returns to it.
 *
 * The cooldown marker is a second, smaller bound and not the termination argument: once
 * it exists it suppresses further outbound attempts for its lifetime, so a browser that
 * keeps asking during an outage stops costing a provider call each time. It is read from
 * the request and written to the response, so it is explicitly NOT a lock — concurrent
 * requests that arrive before the first response carries it back will each attempt once.
 * See `session.ts` for that bound in full, and for why the marker is not a credential.
 */

/**
 * Failures that are about the provider rather than about the token.
 *
 * `unavailable` covers a 5xx, a network failure, and P1-06's bounded timeout, all of
 * which the provider layer already collapses into one reason — this route deliberately
 * re-derives none of that classification and reads no HTTP status of its own.
 *
 * `rate-limited` is here too, and that is a judgement worth stating: a 429 says the
 * provider declined to answer *right now*. It is no more evidence that a refresh token
 * was revoked than a 503 is, and treating it as proof of revocation would sign out
 * exactly the users a rate limit is already inconveniencing.
 *
 * Everything else — `invalid-refresh` above all, but also anything unclassified — ends
 * the session. An unrecognised failure is not something to keep a session open on.
 */
function isTransient(reason: ProviderRejection): boolean {
  return reason === "unavailable" || reason === "rate-limited";
}

/**
 * The terminal outage response.
 *
 * Deliberately not a redirect: that is the whole termination argument above. Deliberately
 * not a 401 either — P0-12 renders a 401 as "Your session ended… sign in again", and the
 * session has not ended. It has not been proven anything. `503` with `Retry-After` says
 * the true thing, and reloading is the retry, which re-requests this same URL with `next`
 * still on it.
 *
 * The body interpolates nothing. `next` is validated but still attacker-influenced text,
 * and the safest way not to inject it into HTML is not to put it there.
 */
function unavailableResponse(): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temporarily unavailable</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; padding: 2rem; color: #1a1a1a; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0; color: #555; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f0f0f; color: #f0f0f0; }
    p { color: #a0a0a0; }
  }
</style>
</head>
<body>
<main>
<h1>Temporarily unavailable</h1>
<p>We couldn't reach the sign-in service just now. You are still signed in — reload this page in a few seconds to continue.</p>
</main>
</body>
</html>`;
  return new Response(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "15",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const destination = safeDestination(url.searchParams.get("next"));
  const traceId = traceIdFrom(request);
  const route = routeOf(request);

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

  const cookies = request.headers.get("cookie");
  const refreshToken = readCookie(cookies, config.refreshCookieName);
  // Checked before the cooldown, and deliberately so: having no credential at all is not
  // an outage. It is the unauthenticated case, and it keeps its original behaviour.
  if (refreshToken === null) return abandon();

  // A very recent attempt already found the provider down. Answer from that knowledge
  // rather than queueing another outbound call behind the same outage.
  if (readCookie(cookies, refreshCooldownCookieName(config)) !== null) {
    log({
      event: "auth.refresh_cooldown",
      level: "info",
      traceId,
      route,
      method: request.method,
      status: 503,
    });
    return withTraceHeader(unavailableResponse(), traceId);
  }

  try {
    const tokens = await createGoTrueProvider(config).refresh(refreshToken);
    log({
      event: "auth.refresh_succeeded",
      level: "info",
      traceId,
      route,
      method: request.method,
      status: 303,
    });
    return appendCookies(
      new Response(null, {
        status: 303,
        headers: {
          location: new URL(destination, url.origin).toString(),
          "cache-control": "no-store",
        },
      }),
      // The marker is cleared on the way through so a later legitimate refresh is never
      // refused by a cooldown that has already served its purpose.
      [...sessionCookies(config, tokens), clearedRefreshCooldownCookie(config)],
    );
  } catch (cause) {
    if (cause instanceof ProviderError && isTransient(cause.reason)) {
      // Operationally important: this is the branch that means the identity provider is
      // down, and it is the one an on-call engineer needs to see. `error_code` carries
      // the provider reason; no token, cookie, or provider body is recorded.
      log({
        event: "auth.refresh_unavailable",
        level: "error",
        traceId,
        route,
        method: request.method,
        status: 503,
        error: cause,
      });
      return withTraceHeader(
        appendCookies(unavailableResponse(), [refreshCooldownCookie(config)]),
        traceId,
      );
    }
    // Rotated, revoked, expired — or anything this layer does not recognise. The session
    // ends here rather than looping, exactly as it did before P1-07.
    log({
      event: "auth.refresh_invalid",
      level: "warn",
      traceId,
      route,
      method: request.method,
      status: 303,
      error: cause,
    });
    return withTraceHeader(abandon(), traceId);
  }
}

export const dynamic = "force-dynamic";
