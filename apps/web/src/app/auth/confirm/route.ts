import { authConfigFromEnv } from "@/server/auth/config";
import { createJwtVerifier } from "@/server/auth/jwt";
import {
  EMAIL_OTP_TYPES,
  createGoTrueProvider,
  type EmailOtpType,
} from "@/server/auth/provider";
import { getDatabase } from "@/server/db";
import { mirrorIdentity } from "@/server/identity/mirror";
import { ensureHousehold } from "@/server/identity/bootstrap";
import { appendCookies, clearedSessionCookies, sessionCookies } from "@/server/auth/session";
import { SIGN_IN_PATH, safeDestination } from "@/server/http/public-routes";
import { log, routeOf, traceIdFrom, withTraceHeader } from "@/server/observability";

/**
 * `GET /auth/confirm?token_hash=…&type=…&next=…` — finish an email confirmation.
 *
 * WHY THIS IS NOT `/auth/callback`
 * -------------------------------
 * `/auth/callback` redeems a PKCE authorization code and requires the verifier cookie that
 * was set when the link was *requested*. That is right for magic links, which are asked for
 * and followed in one sitting, and wrong for confirmation email in two ways that cannot be
 * configured away:
 *
 *   - the verifier lives for 15 minutes, and a confirmation link is routinely followed
 *     hours later;
 *   - it lives in the browser that signed up, and confirmation is routinely opened on a
 *     phone instead.
 *
 * Either alone makes a cookie-bound redemption the wrong shape. So this route redeems the
 * single-use hash GoTrue puts in the email, which is a credential in its own right and is
 * validated by the provider server-side. Nothing about the magic-link flow changes.
 *
 * The defect this closes: with "Confirm email" ON the sign-up route correctly answers 202
 * and leaves the account inert, but nothing then completed it. GoTrue confirmed the address
 * and the application never learned of it, so a confirmed user reached the app unauthenticated
 * and had to sign in by hand. Everything below is the sign-in route's sequence, reached by a
 * different credential.
 *
 * WHAT REACHES THE BROWSER
 * ------------------------
 * No token, ever. The hash arrives in the query string and is exchanged here; the session
 * leaves in `Set-Cookie`, and the `Location` carries a validated same-origin path. The
 * browser never holds a provider session, exactly as `/v1/auth/sign-up` documents.
 *
 * EVERY FAILURE LOOKS THE SAME
 * ----------------------------
 * Expired, already used, never issued, wrong type, or a provider error all end on the same
 * page, which says the link did not work and offers sign-in. A confirmation hash is a
 * bearer credential: reporting *which* way it failed tells someone holding a guess how close
 * they are. Session cookies are cleared on the way out so a half-authenticated browser
 * cannot linger.
 */

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * The terminal failure page.
 *
 * Interpolates nothing — `next` is validated but still attacker-influenced text, and the
 * safest way not to inject it into HTML is not to put it there. Same reasoning, and same
 * shape, as `/auth/refresh`'s outage page.
 */
function linkFailedResponse(): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link didn't work</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; padding: 2rem; color: #1a1a1a; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0 0 1rem; color: #555; }
  a { color: #17595f; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f0f0f; color: #f0f0f0; }
    p { color: #a0a0a0; }
    a { color: #7fd1d8; }
  }
</style>
</head>
<body>
<main>
<h1>This link didn't work</h1>
<p>Confirmation links can only be used once, and they expire. Sign in to continue — if your
address still needs confirming, we'll send a new link.</p>
<p><a href="${SIGN_IN_PATH}">Go to sign in</a></p>
</main>
</body>
</html>`;
  return new Response(body, {
    status: 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Belt and braces: the URL that reached here carried a credential, so nothing about
      // this response should encourage a referrer carrying it onward.
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const traceId = traceIdFrom(request);
  const route = routeOf(request);

  let config;
  try {
    config = authConfigFromEnv();
  } catch {
    return new Response(null, { status: 303, headers: { location: new URL(SIGN_IN_PATH, url.origin).toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  const failed = (): Response =>
    withTraceHeader(
      appendCookies(linkFailedResponse(), clearedSessionCookies(config)),
      traceId,
    );

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // Bounded before it is sent anywhere: an unbounded query parameter is an unbounded
  // outbound request body. The same 512 the callback applies to its code.
  if (tokenHash === null || tokenHash === "" || tokenHash.length > 512) return failed();
  if (!isEmailOtpType(type)) return failed();

  try {
    const tokens = await createGoTrueProvider(config).verifyEmailToken(tokenHash, type);

    // Same order as sign-in and the PKCE callback, deliberately not a third version of it:
    // verify the token, mirror the principal, establish the household, then issue cookies.
    // A redemption that cannot be mirrored abandons rather than handing out a session that
    // resolves to nothing.
    const principal = await createJwtVerifier({
      jwks: config.jwks,
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    }).verify(tokens.accessToken);

    const db = getDatabase();
    await mirrorIdentity(db, principal);
    // Blueprint P1-02, and idempotent by construction: a user who follows the link twice,
    // or who signed in by hand before following it, already has a household and gets that
    // one rather than a second.
    await ensureHousehold(db, principal.userId);

    log({
      event: "auth.email_confirmed",
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
          // The credential does not survive into the next request: the destination is a
          // validated same-origin path, never this URL with its hash still attached.
          location: new URL(safeDestination(url.searchParams.get("next")), url.origin).toString(),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      }),
      sessionCookies(config, tokens),
    );
  } catch (cause) {
    // One branch for every failure, and `warn` rather than `error`: an expired or reused
    // confirmation link is ordinary, not an incident. The reason is recorded; the hash is
    // not, here or anywhere.
    log({
      event: "auth.email_confirm_failed",
      level: "warn",
      traceId,
      route,
      method: request.method,
      status: 400,
      error: cause,
    });
    return failed();
  }
}

export const dynamic = "force-dynamic";
