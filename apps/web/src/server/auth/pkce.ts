import type { AuthConfig } from "./config";

/**
 * PKCE for the magic-link flow (RFC 7636).
 *
 * WHY PKCE AND NOT THE SIMPLER FLOW
 * ---------------------------------
 * GoTrue's implicit flow returns the tokens in the URL *fragment*. Fragments are never
 * sent to a server, so a server-side callback cannot read them — the browser would have
 * to parse them in JavaScript and hand them back, which is precisely the exposure
 * ADR-009 D2 exists to prevent, and it would put tokens in a URL besides. The
 * authorization-code flow is therefore the only one compatible with the frozen design,
 * and PKCE is what makes an authorization code safe to carry in a query string: the code
 * alone is useless without the verifier, which never leaves this origin.
 *
 * THE VERIFIER COOKIE IS NOT A CREDENTIAL
 * ---------------------------------------
 * It authenticates nothing. It is one half of a single-use exchange, scoped to the one
 * path that redeems it, deleted the moment redemption is attempted — success or failure —
 * and worthless without an authorization code the provider only sends to a verified
 * email address. Middleware does not look at it; presenting it alone leaves a request
 * exactly as unauthenticated as presenting nothing.
 */

/** The verifier must outlive the emailed link, which PRD §19 F1 caps at 15 minutes. */
const VERIFIER_TTL_SECONDS = 15 * 60;

/**
 * Scoped to the redemption path, not to `/`. The browser then sends it to exactly one
 * endpoint and never attaches it to an ordinary page load, which is the smallest
 * exposure the flow can be built with.
 */
const VERIFIER_PATH = "/auth/callback";

export function verifierCookieName(config: AuthConfig): string {
  return `${config.cookieName}_pkce`;
}

const BASE64URL = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. 32 bytes gives 43. */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BASE64URL(bytes);
}

/** RFC 7636 §4.2, S256. Plain is never offered — it would defeat the point. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return BASE64URL(new Uint8Array(digest));
}

export interface PendingAuthorization {
  readonly verifier: string;
  /** Where to land after redemption. Carried here, not in the URL — see below. */
  readonly next: string;
}

/**
 * The pending state travels in the cookie rather than in `redirect_to`.
 *
 * Anything placed in the redirect URL is echoed back by the provider and therefore
 * arrives from outside: an attacker who can get a victim to click a crafted link would
 * be choosing the post-login destination. In the cookie it is same-origin state, set by
 * us, and it is still re-validated on the way out.
 */
export function encodePending(state: PendingAuthorization): string {
  return BASE64URL(new TextEncoder().encode(JSON.stringify(state)));
}

export function decodePending(raw: string): PendingAuthorization | null {
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
    );
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { verifier, next } = parsed as Record<string, unknown>;
    if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return null;
    if (typeof next !== "string") return null;
    return { verifier, next };
  } catch {
    return null;
  }
}

function serialize(config: AuthConfig, value: string, maxAge: number): string {
  return [
    `${verifierCookieName(config)}=${value}`,
    `Path=${VERIFIER_PATH}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export function pendingCookie(config: AuthConfig, state: PendingAuthorization): string {
  return serialize(config, encodePending(state), VERIFIER_TTL_SECONDS);
}

/**
 * Cleared on every redemption attempt, not only successful ones. A verifier that
 * survives a failure is a verifier available for a second attempt, which is what makes
 * a replayed authorization code worth trying.
 */
export function clearedPendingCookie(config: AuthConfig): string {
  return serialize(config, "", 0);
}
