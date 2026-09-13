import { z } from "zod";
import type { AuthConfig } from "./config";
import type { SessionTokens } from "./session";

/**
 * GoTrue REST provider (ADR-009 D2/D7).
 *
 * Plain `fetch` against the documented REST surface, deliberately not the SDK. D7's
 * rejection stands: the exchange is documented server-to-server REST, and staying off
 * the SDK is what keeps doc 14's "migrate without token-format change" promise real
 * rather than aspirational. The provider's name appears in configuration, not in code.
 *
 * Only the F1 flows are here. `service_role` is never used — every endpoint below is
 * reachable with the publishable key, and a request path holding the privileged key
 * would violate doc 06 §5's confinement of it to migrations and two named jobs.
 *
 * Stable staging has verified signup, confirmation, password sessions and replay.
 * A provider 504 was observed separately from our deadline. Every call stays single-
 * attempt and bounded: ambiguous credential mutations are never automatically replayed.
 * Coarse user-facing errors remain identical; internal allow-listed diagnostics distinguish
 * an HTTP response from a local deadline or transport failure without retaining bodies,
 * credentials, URLs or arbitrary headers.
 */

/**
 * The existing shared ten-second ceiling bounds a stalled outbound call. It is not
 * a guarantee that the provider will answer before its own gateway timeout.
 */
const PROVIDER_TIMEOUT_MS = 10_000;

export type ProviderRejection =
  /** Wrong password, unknown user, unconfirmed email — one outcome, on purpose. */
  | "invalid-credentials"
  /** The refresh token was rejected: rotated, revoked, or expired. */
  | "invalid-refresh"
  /** The authorization code was wrong, expired, already redeemed, or unmatched. */
  | "invalid-code"
  | "rate-limited"
  | "unavailable";

type ProviderFailure = "http" | "timeout" | "network" | "invalid-response";
interface ProviderDiagnostics { failure: ProviderFailure; durationMs: number; requestId?: string }
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  constructor(
    readonly reason: ProviderRejection,
    message: string,
    /** Numeric HTTP status only; never the provider body or submitted credentials. */
    readonly httpStatus?: number,
    readonly diagnostics?: ProviderDiagnostics,
  ) {
    super(message);
  }
}

/** Explicit projection: safe even if a future caller constructs an error incorrectly. */
export function providerFailureMeta(error: ProviderError): Record<string, unknown> {
  const d = error.diagnostics;
  return {
    ...(Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! < 600 ? { upstream_status: error.httpStatus } : {}),
    ...(d && ["http", "timeout", "network", "invalid-response"].includes(d.failure) ? { upstream_failure: d.failure } : {}),
    ...(d && Number.isInteger(d.durationMs) && d.durationMs >= 0 && d.durationMs <= 600_000 ? { upstream_duration_ms: d.durationMs } : {}),
    ...(d?.requestId && REQUEST_ID.test(d.requestId) ? { upstream_request_id: d.requestId } : {}),
  };
}

/** The provider returns more than this; we deliberately keep only what a session needs. */
const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/**
 * What `/signup` produced.
 *
 * Which arm comes back is the *deployment's* choice, not this code's: GoTrue returns a
 * session when "Confirm email" is off and a bare user record when it is on. Modelling both
 * is how this honours the project's confirmation setting instead of assuming one — and it
 * is why nothing here reads a flag of our own that could disagree with the provider.
 */
/**
 * The confirmation types this application actually emits links for.
 *
 * A closed union rather than a passthrough string: `type` arrives from a URL, and GoTrue
 * accepts several values whose side effects differ. Only the two that correspond to a link
 * this application asks the provider to send are accepted; anything else is refused before
 * a request is made.
 */
export const EMAIL_OTP_TYPES = ["email", "signup"] as const;
export type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

export type SignUpOutcome =
  | { readonly kind: "session"; readonly tokens: SessionTokens }
  | { readonly kind: "confirmation-required" };

export interface AuthProvider {
  signInWithPassword(email: string, password: string): Promise<SessionTokens>;
  /** Create an account. `displayName` is stored as provider user metadata, never a claim we trust. */
  signUp(email: string, password: string, displayName: string): Promise<SignUpOutcome>;
  refresh(refreshToken: string): Promise<SessionTokens>;
  signOut(accessToken: string): Promise<void>;
  /** Ask the provider to email a link that will return an authorization code. */
  requestMagicLink(email: string, codeChallenge: string, redirectTo: string): Promise<void>;
  /** Redeem that code. Useless without the verifier that produced the challenge. */
  exchangeCode(authCode: string, codeVerifier: string): Promise<SessionTokens>;
  /**
   * Redeem the single-use hash from a confirmation email.
   *
   * Deliberately not the PKCE grant above. A confirmation link is followed minutes or days
   * later, and routinely on a different device from the one that signed up, so it cannot
   * depend on a verifier cookie held by the originating browser. The hash is the credential,
   * it is single-use, and GoTrue validates it server-side — which is what lets this stay
   * inside the server-mediated architecture instead of handing a token to the browser.
   */
  verifyEmailToken(tokenHash: string, type: EmailOtpType): Promise<SessionTokens>;
}

/**
 * A refusal's HTTP status, classified as either a fact about the ACCOUNT or a fact about
 * the DEPLOYMENT. The distinction is not cosmetic: the caller's fallback becomes a 202 on
 * sign-up and a 401 on sign-in, while `unavailable` becomes a 503, so a status routed to
 * the wrong side is visible to anyone who can send two requests.
 *
 * 422 is the case that matters, and it was missing. GoTrue answers a repeat sign-up with
 * `422 user_already_exists`, so a registered address fell through to `unavailable` and the
 * endpoint returned 503 where a fresh address returned 204 — an account-enumeration oracle
 * in the one endpoint whose header promises there is none, and the exact thing the 202 is
 * for. Staging found it; the unit test beside it did not, because it asserted only that the
 * provider's wording never reaches the caller and never asserted the classification.
 *
 * Both are now covered, and 422 sits with 400/401/403 where it belongs: the provider is
 * telling us something about the account, not about itself.
 */
function mapStatus(status: number, fallback: ProviderRejection): ProviderRejection {
  if (status === 400 || status === 401 || status === 403 || status === 422) return fallback;
  if (status === 429) return "rate-limited";
  return "unavailable";
}

export function createGoTrueProvider(
  config: AuthConfig,
  fetchImpl: typeof fetch = fetch,
  /** Test seam, same purpose as `fetchImpl` above: production always takes the default. */
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): AuthProvider {
  const headers = {
    "content-type": "application/json",
    // GoTrue requires the publishable key on every call, including anonymous ones.
    apikey: config.anonKey,
  };

  function diagnostics(failure: ProviderFailure, start: number, response?: Response): ProviderDiagnostics {
    const requestId = response?.headers.get("sb-request-id");
    return { failure, durationMs: Math.max(0, Math.round(performance.now() - start)),
      ...(requestId && REQUEST_ID.test(requestId) ? { requestId } : {}) };
  }

  async function post(url: string, body: Record<string, unknown>) {
    const start = performance.now(), signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal });
      return { response, start, signal };
    } catch {
      throw new ProviderError("unavailable", "the identity provider could not be reached", undefined,
        diagnostics(signal.aborted ? "timeout" : "network", start));
    }
  }

  /**
   * One POST that must come back as a session.
   *
   * Extracted from `tokenGrant` when `/verify` joined it: email confirmation redeems a
   * single-use token hash at a different endpoint, but every other property — the timeout,
   * the silence about the provider's body, the classification of a refusal, and the refusal
   * to accept a response that does not parse as tokens — must be identical. Two copies of
   * that reasoning would be two places for it to drift.
   */
  async function postForTokens(
    url: string,
    body: Record<string, string>,
    onRejection: ProviderRejection,
  ): Promise<SessionTokens> {
    const { response, start, signal } = await post(url, body);

    if (!response.ok) {
      // The provider's body is never surfaced or logged: it distinguishes "no such user"
      // from "wrong password", which is an account-enumeration oracle.
      void response.body?.cancel().catch(() => undefined);
      throw new ProviderError(mapStatus(response.status, onRejection), "sign-in was refused", response.status, diagnostics("http", start, response));
    }

    const parsed = TokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ProviderError("unavailable", "the identity provider returned an unusable response", response.status,
        diagnostics(signal.aborted ? "timeout" : "invalid-response", start, response));
    }
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresIn: parsed.data.expires_in,
    };
  }

  function tokenGrant(
    grant: "password" | "refresh_token" | "pkce",
    body: Record<string, string>,
    onRejection: ProviderRejection,
  ): Promise<SessionTokens> {
    return postForTokens(`${config.apiUrl}/token?grant_type=${grant}`, body, onRejection);
  }

  return {
    signInWithPassword(email, password) {
      return tokenGrant("password", { email, password }, "invalid-credentials");
    },

    async signUp(email, password, displayName) {
      // Not `tokenGrant`: `/signup` is the one provider call whose success may legitimately
      // carry no tokens, so a helper that insists on parsing a token response would turn the
      // confirmation-required deployment into a spurious "unusable response".
      const { response, start } = await post(`${config.apiUrl}/signup`, { email, password, data: { display_name: displayName } });

      if (!response.ok) {
        // The body is never surfaced. GoTrue distinguishes "already registered" from a
        // rejected password, and passing that through would hand the caller an
        // account-enumeration oracle the route then has to un-leak.
        void response.body?.cancel().catch(() => undefined);
        throw new ProviderError(mapStatus(response.status, "invalid-credentials"), "sign-up was refused", response.status, diagnostics("http", start, response));
      }

      const body: unknown = await response.json().catch(() => null);
      const session = TokenResponseSchema.safeParse(body);
      if (session.success) {
        return {
          kind: "session",
          tokens: {
            accessToken: session.data.access_token,
            refreshToken: session.data.refresh_token,
            expiresIn: session.data.expires_in,
          },
        };
      }
      // A 2xx with no token set is GoTrue saying the account exists but is unconfirmed.
      // That includes the obfuscated user it returns for an address already registered,
      // which is exactly the response that keeps this endpoint from confirming membership.
      return { kind: "confirmation-required" };
    },

    refresh(refreshToken) {
      return tokenGrant("refresh_token", { refresh_token: refreshToken }, "invalid-refresh");
    },

    exchangeCode(authCode, codeVerifier) {
      return tokenGrant("pkce", { auth_code: authCode, code_verifier: codeVerifier }, "invalid-code");
    },

    verifyEmailToken(tokenHash, type) {
      // `invalid-code` on refusal, for the same reason redemption uses it: expired, already
      // consumed, and never-issued must be one outcome. Distinguishing them would tell a
      // stranger holding a guessed hash which guess was closer.
      return postForTokens(
        `${config.apiUrl}/verify`,
        { type, token_hash: tokenHash },
        "invalid-code",
      );
    },

    async requestMagicLink(email, codeChallenge, redirectTo) {
      // S256 only. Offering `plain` would let anyone who sees the authorization request
      // reconstruct the verifier, which is the whole thing PKCE prevents.
      const { response, start } = await post(`${config.apiUrl}/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
        { email, code_challenge: codeChallenge, code_challenge_method: "S256" });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new ProviderError(mapStatus(response.status, "invalid-credentials"), "the link could not be sent",
          response.status, diagnostics("http", start, response));
      }
    },

    async signOut(accessToken) {
      try {
        // Best effort by design. The cookies are cleared regardless of what the provider
        // says, because a user who pressed sign-out must end up signed out of this
        // origin even when the provider is unreachable. Bounded all the same: a hang
        // here has no error to swallow until the timeout fires it.
        await fetchImpl(`${config.apiUrl}/logout`, {
          method: "POST",
          headers: { ...headers, authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        /* deliberately swallowed — see above */
      }
    },
  };
}
