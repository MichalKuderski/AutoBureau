import { z } from "zod";
import { authConfigFromEnv } from "@/server/auth/config";
import { createJwtVerifier, TokenError } from "@/server/auth/jwt";
import { createGoTrueProvider, ProviderError } from "@/server/auth/provider";
import { getDatabase } from "@/server/db";
import { MirrorError, mirrorIdentity } from "@/server/identity/mirror";
import { appendCookies, sessionCookies } from "@/server/auth/session";
import { assertSameSiteRequest, CsrfError } from "@/server/http/csrf";
import { problemResponse } from "@/server/http/problem";

/**
 * `POST /v1/auth/sign-in` — exchange credentials for a session (ADR-009 D2).
 *
 * Public by necessity: an endpoint that established sessions but required one could
 * never be reached. It is therefore *not* wrapped in `authenticated()`, and enforces the
 * two checks that wrapper would otherwise have applied — CSRF, and problem+json errors.
 *
 * The response body carries no token. The entire point of D2 is that the browser never
 * holds one; returning it "for convenience" would undo the design while leaving the
 * cookies looking correct.
 */

const CredentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

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

  const parsed = CredentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return problemResponse("validation", { detail: "Enter an email address and a password." });
  }

  try {
    const tokens = await createGoTrueProvider(config).signInWithPassword(
      parsed.data.email,
      parsed.data.password,
    );

    // The token is verified before it is stored. That proves the provider's issuer,
    // audience and algorithm are ones this deployment accepts *at sign-in*, rather than
    // handing out a session that fails on the next request — and it is the only
    // trustworthy source for the subject and email the mirror needs.
    const principal = await createJwtVerifier({
      jwks: config.jwks,
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    }).verify(tokens.accessToken);

    // Mirror before the cookies exist. A session whose identity is not in this database
    // is a session that resolves to 403 on every request; issuing one would be creating
    // a partially usable identity, which is exactly what must not happen.
    await mirrorIdentity(getDatabase(), principal);

    // 204: nothing to say that the cookies do not already carry.
    return appendCookies(
      new Response(null, { status: 204, headers: { "cache-control": "no-store" } }),
      sessionCookies(config, tokens),
    );
  } catch (cause) {
    // The provider answered, but with a token this deployment cannot accept, or with an
    // identity that cannot be mirrored. Both are deployment or provider faults rather
    // than the caller's, and neither may explain itself: the detail is the same neutral
    // sentence a transport failure gets, and nothing from the database or the provider
    // reaches the response.
    if (cause instanceof TokenError || cause instanceof MirrorError) {
      if (process.env.NODE_ENV !== "production") console.error("[auth:sign-in]", cause);
      return problemResponse("unavailable", { detail: "Sign-in is briefly unavailable." });
    }
    if (cause instanceof ProviderError) {
      if (cause.reason === "rate-limited") {
        return problemResponse("rate-limited", { detail: "Too many attempts — try again shortly." });
      }
      if (cause.reason === "unavailable") {
        return problemResponse("unavailable", { detail: "Sign-in is briefly unavailable." });
      }
      // One message for wrong password and unknown address alike: distinguishing them
      // tells an attacker which addresses have accounts.
      return problemResponse("unauthorized", {
        detail: "That email and password don't match an account.",
      });
    }
    // Never surfaced: an unexpected throw could carry a query, a row, or a connection
    // string in its message.
    if (process.env.NODE_ENV !== "production") console.error("[auth:sign-in]", cause);
    return problemResponse("internal");
  }
}

export const dynamic = "force-dynamic";
