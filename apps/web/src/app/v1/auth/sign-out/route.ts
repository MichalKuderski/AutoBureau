import { authConfigFromEnv } from "@/server/auth/config";
import { readCookie } from "@/server/auth/context";
import { createGoTrueProvider } from "@/server/auth/provider";
import { appendCookies, clearedSessionCookies } from "@/server/auth/session";
import { assertSameSiteRequest, CsrfError } from "@/server/http/csrf";
import { problemResponse } from "@/server/http/problem";

/**
 * `POST /v1/auth/sign-out` — end the session (PRD §19 F1: "logout kills refresh token").
 *
 * Public, so that a user whose access token has already expired can still clear their
 * cookies. CSRF is still required: a cross-site forced sign-out is a nuisance attack,
 * and D4 admits no exceptions by method.
 *
 * The cookies are cleared whatever the provider says. A user who pressed sign-out must
 * end up signed out of this origin even if the provider is unreachable — the alternative
 * leaves a live session behind on a failed network call.
 */
export async function POST(request: Request): Promise<Response> {
  let config;
  try {
    config = authConfigFromEnv();
  } catch {
    return problemResponse("unavailable", {
      detail: "Authentication is not configured on this deployment.",
    });
  }

  try {
    assertSameSiteRequest(request, { allowedOrigins: config.allowedOrigins });
  } catch (cause) {
    if (cause instanceof CsrfError) {
      return problemResponse("forbidden", { detail: "This request could not be verified." });
    }
    throw cause;
  }

  const accessToken = readCookie(request.headers.get("cookie"), config.cookieName);
  if (accessToken !== null) {
    await createGoTrueProvider(config).signOut(accessToken);
  }

  return appendCookies(
    new Response(null, { status: 204, headers: { "cache-control": "no-store" } }),
    clearedSessionCookies(config),
  );
}

export const dynamic = "force-dynamic";
