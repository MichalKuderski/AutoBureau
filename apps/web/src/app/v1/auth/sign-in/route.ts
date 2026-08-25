import { z } from "zod";
import { authConfigFromEnv } from "@/server/auth/config";
import { createJwtVerifier, TokenError } from "@/server/auth/jwt";
import { createGoTrueProvider, ProviderError } from "@/server/auth/provider";
import { getDatabase } from "@/server/db";
import { MirrorError, mirrorIdentity } from "@/server/identity/mirror";
import { ensureHousehold } from "@/server/identity/bootstrap";
import { appendCookies, sessionCookies } from "@/server/auth/session";
import { assertSameSiteRequest, CsrfError } from "@/server/http/csrf";
import { problemResponse } from "@/server/http/problem";
import {
  SIGN_IN_CLEAR_ON_SUCCESS,
  SIGN_IN_POLICIES,
  clearRateLimit,
  enforceRateLimit,
} from "@/server/http/rate-limit";
import { log, routeOf, traceIdFrom, withTraceHeader } from "@/server/observability";

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
  const traceId = traceIdFrom(request);
  const route = routeOf(request);

  let config;
  try {
    config = authConfigFromEnv();
  } catch (cause) {
    log({
      event: "auth.not_configured",
      level: "error",
      traceId,
      route,
      method: request.method,
      status: 503,
      error: cause,
    });
    return withTraceHeader(
      problemResponse("unavailable", {
        detail: "Authentication is not configured on this deployment.",
      }),
      traceId,
    );
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
    // Inside the `try` on purpose: `getDatabase()` throws `DatabaseConfigError` when
    // `DATABASE_URL` is unset, and that has always been reported by the catch below as a
    // logged 500 rather than as an unhandled throw. Hoisting it out to sit beside the
    // limiter would have quietly changed that.
    const db = getDatabase();

    // Blueprint P1-08, placed exactly where ADR-013 D9 puts it: after CSRF and after the
    // body has parsed, and BEFORE the provider is asked anything. Before the provider
    // matters twice over — it is what makes an attempt cost us nothing outbound, and it is
    // what keeps the 429 from depending on whether the account exists, which would turn
    // this endpoint into the enumeration oracle the neutral failure message below prevents.
    const limited = await enforceRateLimit({
      db,
      request,
      identifier: parsed.data.email,
      policies: SIGN_IN_POLICIES,
      traceId,
      route,
    });
    if (limited !== null) return withTraceHeader(limited, traceId);

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
    await mirrorIdentity(db, principal);

    // Blueprint P1-02, and the same sentence applies: a mirrored principal belonging to
    // no household also resolves to 403 on every request. The identity is only complete
    // once it can enter the application, so the household is established here too —
    // still before the cookies exist.
    await ensureHousehold(db, principal.userId);

    // ADR-013 D6: a success clears this subject's identifier buckets, so someone who
    // mistyped four times and then got it right is not left one attempt from a lockout.
    // Only after the sign-in has fully succeeded — a mirror failure is not a success — and
    // deliberately not the per-IP bucket, which is shared with everyone else behind that
    // address. Best effort: a clear that fails must not fail the sign-in.
    await clearRateLimit({
      db,
      request,
      identifier: parsed.data.email,
      policies: SIGN_IN_CLEAR_ON_SUCCESS,
      traceId,
      route,
    });

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
      // A deployment or provider fault, not a caller error: the `reason` enum on both of
      // these becomes `error_code`, which is the field that distinguishes "the provider
      // issued a token we reject" from "the identity could not be mirrored".
      log({
        event: "auth.sign_in_failed",
        level: "error",
        traceId,
        route,
        method: request.method,
        status: 503,
        error: cause,
        stack: true,
      });
      return withTraceHeader(
        problemResponse("unavailable", { detail: "Sign-in is briefly unavailable." }),
        traceId,
      );
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
    // string in its message. This is the branch a database fault lands in — including the
    // unique-violation path audit 05 (P1-1) found returning a 500 with no trace of it
    // anywhere. `error_code` carries the Prisma code, and the message is scrubbed, so the
    // conflicting value never reaches the record.
    log({
      event: "auth.sign_in_error",
      level: "error",
      traceId,
      route,
      method: request.method,
      status: 500,
      error: cause,
      stack: true,
    });
    return withTraceHeader(problemResponse("internal"), traceId);
  }
}

export const dynamic = "force-dynamic";
