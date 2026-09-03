import { z } from "zod";
import { authConfigFromEnv } from "@/server/auth/config";
import { createJwtVerifier, TokenError } from "@/server/auth/jwt";
import { createGoTrueProvider, ProviderError } from "@/server/auth/provider";
import { appendCookies, sessionCookies } from "@/server/auth/session";
import { getDatabase } from "@/server/db";
import { ensureHousehold } from "@/server/identity/bootstrap";
import { MirrorError, mirrorIdentity } from "@/server/identity/mirror";
import { assertSameSiteRequest, CsrfError } from "@/server/http/csrf";
import { problemResponse } from "@/server/http/problem";
import { SIGN_UP_POLICIES, enforceRateLimit } from "@/server/http/rate-limit";
import { assessPassword, isPlausibleEmail } from "@/lib/password";
import { log, routeOf, traceIdFrom, withTraceHeader } from "@/server/observability";

/**
 * `POST /v1/auth/sign-up` — create an account (blueprint P1-02, ADR-009 D2/D8).
 *
 * WHY A SERVER ROUTE RATHER THAN A BROWSER SUPABASE CLIENT
 * -------------------------------------------------------
 * The architecture is server-mediated: the browser never holds a provider session and never
 * talks to the provider or the database directly. Calling GoTrue from the client would
 * create a second authentication system beside this one — its own token storage, its own
 * refresh, its own CSRF story — and the cookies this application actually authenticates with
 * would still have to be minted here afterwards. So sign-up goes through the same door
 * sign-in does, and `AUTH_ANON_KEY` stays on the server with everything else.
 *
 * TWO OUTCOMES, AND THE DEPLOYMENT PICKS
 * --------------------------------------
 * With Supabase's "Confirm email" on, `/signup` returns no session and the account is inert
 * until the emailed link is followed — which lands on `/auth/callback`, where mirroring and
 * household bootstrap already run. With it off, `/signup` returns tokens and this route
 * completes the identity here, by exactly the sequence `/v1/auth/sign-in` uses. Neither path
 * is assumed: the provider's response decides, so the route is correct under either setting
 * and does not drift when the setting changes.
 *
 * WHAT IT NEVER REVEALS
 * ---------------------
 * The confirmation-required answer is identical for a new address and one already
 * registered. GoTrue returns an obfuscated user for the latter precisely so that sign-up is
 * not a membership oracle, and this route preserves that rather than helpfully reporting a
 * conflict. The same reasoning `/v1/auth/magic-link` records for its always-204.
 */

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
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
    return problemResponse("validation", { detail: "Check the details and try again." });
  }

  // Server-side validation of the same rules the form shows. The client copy calls the meter
  // a guide and says the binding check happens here — this is that check. A client that
  // skips the form entirely gets the same answer, which is the only version that counts.
  if (!isPlausibleEmail(parsed.data.email)) {
    return problemResponse("validation", { detail: "Enter an address we can reach you at." });
  }
  const assessment = assessPassword(parsed.data.password, parsed.data.email);
  if (!assessment.acceptable) {
    return problemResponse("validation", { detail: assessment.hint });
  }

  // Before the provider call, for the reason magic-link states: afterwards the mail has
  // already been sent and the account already exists. Keyed on the address and the source,
  // never on anything that would let one requester exhaust another's budget.
  const limited = await enforceRateLimit({
    db: getDatabase(),
    request,
    identifier: parsed.data.email,
    policies: SIGN_UP_POLICIES,
    traceId,
    route,
  });
  if (limited !== null) return withTraceHeader(limited, traceId);

  /** Same body for a fresh address and one already registered — see the header. */
  const pending = (): Response =>
    withTraceHeader(
      Response.json(
        { status: "confirmation-required" },
        { status: 202, headers: { "cache-control": "no-store" } },
      ),
      traceId,
    );

  try {
    const outcome = await createGoTrueProvider(config).signUp(
      parsed.data.email,
      parsed.data.password,
      parsed.data.name,
    );

    if (outcome.kind === "confirmation-required") return pending();

    // The deployment does not require confirmation, so this response carries a real session
    // — and a session is only issued once the identity behind it is complete. The order and
    // the reasoning are `/v1/auth/sign-in`'s, deliberately not a second version of them:
    // verify the token, mirror the principal, establish the household, then set cookies.
    const db = getDatabase();
    const principal = await createJwtVerifier({
      jwks: config.jwks,
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    }).verify(outcome.tokens.accessToken);

    await mirrorIdentity(db, principal);
    await ensureHousehold(db, principal.userId);

    return appendCookies(
      new Response(null, { status: 204, headers: { "cache-control": "no-store" } }),
      sessionCookies(config, outcome.tokens),
    );
  } catch (cause) {
    if (cause instanceof ProviderError) {
      if (cause.reason === "rate-limited") {
        return problemResponse("rate-limited", { detail: "Too many attempts — try again shortly." });
      }
      if (cause.reason === "unavailable") {
        return problemResponse("unavailable", { detail: "Sign-up is briefly unavailable." });
      }
      // Everything else the provider refused is a fact about the account rather than the
      // request — an address already registered, above all. Answering as though the signup
      // were accepted is what keeps this from confirming who has an account; the person who
      // genuinely owns that address gets the provider's own "you already have an account"
      // mail, and the person guessing gets nothing to learn from.
      return pending();
    }
    if (cause instanceof TokenError || cause instanceof MirrorError) {
      // The account now exists at the provider but this deployment could not complete the
      // identity behind it. Reported as a deployment fault, and deliberately not as a
      // success: issuing no cookies leaves the person able to sign in once it is fixed,
      // where mirroring and bootstrap run again.
      log({
        event: "auth.sign_up_incomplete",
        level: "error",
        traceId,
        route,
        method: request.method,
        status: 503,
        error: cause,
        stack: true,
      });
      return withTraceHeader(
        problemResponse("unavailable", { detail: "Sign-up is briefly unavailable." }),
        traceId,
      );
    }
    throw cause;
  }
}

export const dynamic = "force-dynamic";
