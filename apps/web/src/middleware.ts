import { NextResponse, type NextRequest } from "next/server";
import { problem } from "@autobureau/contracts";
import { authConfigFromEnv, type AuthConfig } from "@/server/auth/config";
import { readCookie } from "@/server/auth/context";
import { TokenError, createJwtVerifier, type JwtVerifier } from "@/server/auth/jwt";
import { NONCE_HEADER, buildCsp, createNonce } from "@/server/http/csp";
import {
  DEFAULT_DESTINATION,
  SIGN_IN_PATH,
  isPublicPath,
  safeDestination,
} from "@/server/http/public-routes";

/**
 * Route protection (ADR-009 D3).
 *
 * This layer authenticates and routes. It does not authorize, does not touch the
 * database, does not open a household scope, and does not mutate session state — every
 * one of those belongs to the request tier, where a pooled connection and a
 * `RequestContext` legitimately exist.
 *
 * The refresh consequence of D3 is deliberate. Rotating a refresh token is mutation, so
 * middleware may not do it; an expired-but-refreshable session is redirected to
 * `/auth/refresh`, which rotates server-side and comes back. That costs one redirect, and
 * the alternative — the conventional refresh-in-middleware — would have required amending
 * frozen governance to save it.
 *
 * The loop guard is structural rather than a counter. Middleware only redirects to
 * refresh when a refresh cookie is present; `/auth/refresh` clears both cookies when it
 * fails. So a failing refresh removes the very condition that triggers the redirect, and
 * the second pass falls through to sign-in. Nothing has to be remembered between
 * requests, which is what lets middleware stay free of state.
 */

/**
 * Catch-all. Everything except framework internals and static files is matched, so a
 * route added tomorrow is protected without anyone remembering to protect it. The
 * exclusions are assets Next serves itself and which carry no household data.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt).*)"],
};

export type MiddlewareDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "unauthorized" };

export interface MiddlewareDeps {
  readonly config: AuthConfig;
  readonly verifier: JwtVerifier;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

/**
 * The whole decision, as a pure function of the request. Exported so it can be driven
 * directly by tests — the branch that matters is which of three outcomes a given request
 * produces, and that is testable without a server.
 */
export async function evaluate(
  request: NextRequest,
  deps: MiddlewareDeps | null,
): Promise<MiddlewareDecision> {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) return { kind: "allow" };

  // No configuration means no way to verify anything. Denying is the only safe answer:
  // failing open here would make an unconfigured deployment an unauthenticated one.
  if (deps === null) return deny(pathname, pathname + search);

  const token = readCookie(request.headers.get("cookie"), deps.config.cookieName);
  if (token === null) return deny(pathname, pathname + search);

  try {
    await deps.verifier.verify(token);
    return { kind: "allow" };
  } catch (cause) {
    const refreshable =
      cause instanceof TokenError &&
      cause.reason === "expired" &&
      readCookie(request.headers.get("cookie"), deps.config.refreshCookieName) !== null;

    if (refreshable && !isApiPath(pathname)) {
      const next = encodeURIComponent(safeDestination(pathname + search));
      return { kind: "redirect", to: `/auth/refresh?next=${next}` };
    }
    // An expired token on `/v1` is a 401: the client owns its own retry, and bouncing an
    // XHR through a redirect chain would corrupt it.
    return deny(pathname, pathname + search);
  }
}

function deny(pathname: string, attempted: string): MiddlewareDecision {
  if (isApiPath(pathname)) return { kind: "unauthorized" };
  const next = encodeURIComponent(safeDestination(attempted));
  return { kind: "redirect", to: `${SIGN_IN_PATH}?next=${next}` };
}

let cached: MiddlewareDeps | null | undefined;

function deps(): MiddlewareDeps | null {
  if (cached !== undefined) return cached;
  try {
    const authConfig = authConfigFromEnv();
    cached = {
      config: authConfig,
      verifier: createJwtVerifier({
        jwks: authConfig.jwks,
        issuer: authConfig.issuer,
        audience: authConfig.audience,
        algorithms: authConfig.algorithms,
      }),
    };
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * The routing decision, plus the one security header that has to be built per request.
 *
 * The decision is `evaluate`'s alone and is taken first, exactly as before — the CSP is
 * layered onto whatever response that produces, and cannot change which response that
 * is. Every branch gets the header, redirects included: a redirect carries no document
 * today, but a policy that is only present on the happy path is one refactor away from
 * being absent where it matters.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const decision = await evaluate(request, deps());

  const nonce = createNonce();
  const csp = buildCsp({ nonce, allowEval: process.env.NODE_ENV === "development" });

  const response = ((): NextResponse => {
    switch (decision.kind) {
      case "allow": {
        // Two readers, one value. `x-nonce` is for our own inline theme script, which the
        // root layout stamps; `content-security-policy` on the *request* is how Next
        // learns the nonce for the RSC payload scripts it inlines itself. Both come from
        // the `nonce` above, so the script the browser receives and the policy it
        // enforces are the same value by construction.
        const headers = new Headers(request.headers);
        headers.set(NONCE_HEADER, nonce);
        headers.set("content-security-policy", csp);
        return NextResponse.next({ request: { headers } });
      }
      case "redirect":
        return NextResponse.redirect(new URL(decision.to, request.nextUrl.origin));
      case "unauthorized":
        return NextResponse.json(problem("unauthorized", { detail: "Sign in to continue." }), {
          status: 401,
          headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
        });
    }
  })();

  response.headers.set("content-security-policy", csp);
  return response;
}

/** Test seam: the module-level cache would otherwise outlive an environment change. */
export function resetMiddlewareCache(): void {
  cached = undefined;
}

export { DEFAULT_DESTINATION };
