import { authConfigFromEnv } from "@/server/auth/config";
import { readCookie } from "@/server/auth/context";
import {
  clearedPendingCookie,
  decodePending,
  verifierCookieName,
} from "@/server/auth/pkce";
import { createJwtVerifier } from "@/server/auth/jwt";
import { createGoTrueProvider } from "@/server/auth/provider";
import { getDatabase } from "@/server/db";
import { mirrorIdentity } from "@/server/identity/mirror";
import { ensureHousehold } from "@/server/identity/bootstrap";
import { appendCookies, clearedSessionCookies, sessionCookies } from "@/server/auth/session";
import { SIGN_IN_PATH, safeDestination } from "@/server/http/public-routes";

/**
 * `GET /auth/callback?code=…` — redeem an authorization code (ADR-009 D2).
 *
 * The provider sends only a code. The verifier that pairs with it has been sitting in an
 * `HttpOnly` cookie scoped to this path since the link was requested, so redemption is
 * possible on this origin and nowhere else: a code intercepted from the email, the
 * browser history, or a referrer header is inert without it.
 *
 * EVERY FAILURE LOOKS THE SAME AND ENDS THE SAME WAY.
 * Missing verifier, wrong verifier, expired code, replayed code, provider error, or a
 * malformed response all clear the pending cookie, clear any session cookies, and land on
 * sign-in with nothing said about which it was. The pending cookie is cleared even on
 * success — it has been spent — and clearing it on failure is what makes a replayed code
 * useless: the second attempt has no verifier to offer.
 *
 * No token appears in the redirect. The `Location` carries a validated same-origin path
 * and nothing else; the session travels in `Set-Cookie`.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

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
        headers: {
          location: new URL(SIGN_IN_PATH, url.origin).toString(),
          "cache-control": "no-store",
        },
      }),
      [clearedPendingCookie(config), ...clearedSessionCookies(config)],
    );

  const pendingRaw = readCookie(request.headers.get("cookie"), verifierCookieName(config));
  if (pendingRaw === null) return abandon();

  const pending = decodePending(pendingRaw);
  if (pending === null) return abandon();

  // The provider reports its own failures in the query string. They are acted on but
  // never echoed: `error_description` is provider prose about someone's account.
  if (url.searchParams.get("error") !== null) return abandon();

  const code = url.searchParams.get("code");
  if (code === null || code === "" || code.length > 512) return abandon();

  try {
    const tokens = await createGoTrueProvider(config).exchangeCode(code, pending.verifier);

    // Same order as sign-in: verify, mirror, admit, then issue. A redemption that cannot
    // be mirrored abandons rather than handing out a session that resolves to nothing.
    const principal = await createJwtVerifier({
      jwks: config.jwks,
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    }).verify(tokens.accessToken);
    const db = getDatabase();
    await mirrorIdentity(db, principal);
    // Blueprint P1-02. A mirrored principal with no household resolves `no-membership`
    // on every request, so the session is only worth issuing once one exists.
    await ensureHousehold(db, principal.userId);

    return appendCookies(
      new Response(null, {
        status: 303,
        headers: {
          // Re-validated here even though it was validated when stored: the cookie is
          // same-origin state, but a destination is worth checking at the moment it is used.
          location: new URL(safeDestination(pending.next), url.origin).toString(),
          "cache-control": "no-store",
        },
      }),
      [clearedPendingCookie(config), ...sessionCookies(config, tokens)],
    );
  } catch {
    return abandon();
  }
}

export const dynamic = "force-dynamic";
