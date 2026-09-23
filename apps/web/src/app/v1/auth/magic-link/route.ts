import { z } from "zod";
import { authConfigFromEnv } from "@/server/auth/config";
import { createCodeVerifier, deriveCodeChallenge, pendingCookie } from "@/server/auth/pkce";
import { createGoTrueProvider, ProviderError } from "@/server/auth/provider";
import { appendCookies } from "@/server/auth/session";
import { getDatabase } from "@/server/db";
import { assertSameSiteRequest, CsrfError } from "@/server/http/csrf";
import { problemResponse } from "@/server/http/problem";
import { MAGIC_LINK_POLICIES, enforceRateLimit } from "@/server/http/rate-limit";
import { safeDestination } from "@/server/http/public-routes";
import { routeOf, traceIdFrom, withTraceHeader } from "@/server/observability";

/**
 * `POST /v1/auth/magic-link` — begin an authorization-code exchange (ADR-009 D2).
 *
 * The verifier is generated here, kept here, and never sent anywhere: only its SHA-256
 * challenge goes to the provider, and only the resulting code comes back. That is what
 * makes the code safe to travel through an email and a query string.
 *
 * The response is always 204, whatever the provider says about the address. Reporting
 * "no such account" would turn this endpoint into a membership oracle for every email
 * address someone cares to try — and the user-visible behaviour is identical either way,
 * because the answer arrives by email or not at all.
 */

const RequestSchema = z.object({
  email: z.string().email().max(320),
  next: z.string().max(2048).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const traceId = traceIdFrom(request);
  const route = routeOf(request);

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

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return problemResponse("validation", { detail: "Enter an email address." });
  }

  // Blueprint P1-08, and on this endpoint "before the provider call" is the whole point:
  // after it, the mail has already been sent to someone who did not ask for it. This runs
  // before the PKCE verifier is minted too, so a refused request starts no flow and leaves
  // no pending cookie behind.
  //
  // A `429` here does not undo the 204-always rule below. That rule hides whether an
  // ADDRESS has an account; this reports how often THIS REQUESTER has asked, which is the
  // same answer for a real address and an invented one at the same rate.
  const limited = await enforceRateLimit({
    db: getDatabase(),
    request,
    identifier: parsed.data.email,
    policies: MAGIC_LINK_POLICIES,
    traceId,
    route,
  });
  if (limited !== null) return withTraceHeader(limited, traceId);

  const verifier = createCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);
  // Validated on the way in as well as on the way out: a destination that was never
  // acceptable should not be stored in the first place.
  const next = safeDestination(parsed.data.next ?? null);

  const accepted = appendCookies(
    new Response(null, { status: 204, headers: { "cache-control": "no-store" } }),
    [pendingCookie(config, { verifier, next })],
  );

  try {
    await createGoTrueProvider(config).requestMagicLink(
      parsed.data.email,
      challenge,
      `${config.allowedOrigins[0]}/auth/callback`,
    );
  } catch (cause) {
    if (cause instanceof ProviderError) {
      // Only conditions that are true of the *request* rather than of the account are
      // reported. An unknown address is indistinguishable from a known one.
      if (cause.reason === "rate-limited") {
        return problemResponse("rate-limited", { detail: "Too many attempts — try again shortly." });
      }
      if (cause.reason === "unavailable") {
        return problemResponse("unavailable", { detail: "Sign-in is briefly unavailable." });
      }
      return accepted;
    }
    throw cause;
  }

  return accepted;
}

export const dynamic = "force-dynamic";
