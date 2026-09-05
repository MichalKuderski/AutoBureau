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
 * PROVIDER COMPATIBILITY IS UNVERIFIED. There is no Supabase project yet, so these
 * request shapes are written against the documented contract and exercised against a
 * contract-shaped local server in the tests. What is proved is our client — its headers,
 * its parsing, its error mapping, and that it never leaks a provider response. Whether
 * the real provider agrees is the first thing to check once a project exists.
 *
 * EVERY CALL IS BOUNDED (blueprint P1-06). Before this, none of the three `fetchImpl`
 * calls carried an `AbortSignal`, so a hung GoTrue left the request open until the
 * platform's own timeout — turning a dependency outage into an availability outage for
 * sign-in, refresh, and the magic-link request alike. `PROVIDER_TIMEOUT_MS` is not an
 * SLO: it is a deadline on one outbound call, chosen to outlast ordinary provider and
 * mobile-network latency while still bounding a genuine hang. No architecture document
 * prescribes a value, so 10 seconds is this module's own choice — generous next to a
 * token exchange's usual sub-second reply, short next to the minutes a stuck connection
 * would otherwise cost. All three calls share it: nothing here suggests sign-in, refresh,
 * and the OTP request need different budgets, and a single constant is one fewer place
 * for that judgement call to drift.
 *
 * A timeout aborts the `fetch`, which rejects with a `DOMException`/`AbortError` — caught
 * by the same `catch` that already handles a network failure, so it becomes the existing
 * `unavailable` classification rather than a distinct error path. Callers do not change:
 * they already treat "the provider could not be reached" and "the provider hung" as the
 * same fault, because from here they are indistinguishable and equally not the caller's
 * problem to solve.
 */

/**
 * The deadline on one outbound provider call. See the module header for why 10s and why
 * shared — this is deliberately the only place the number is written.
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

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  constructor(
    readonly reason: ProviderRejection,
    message: string,
  ) {
    super(message);
  }
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

  async function tokenGrant(
    grant: "password" | "refresh_token" | "pkce",
    body: Record<string, string>,
    onRejection: ProviderRejection,
  ): Promise<SessionTokens> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.apiUrl}/token?grant_type=${grant}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Network failure and timeout land here identically: `AbortSignal.timeout` rejects
      // the fetch the same way a DNS failure or a connection reset would, and both are
      // "the provider could not be reached" from a caller's point of view.
      throw new ProviderError("unavailable", "the identity provider could not be reached");
    }

    if (!response.ok) {
      // The provider's body is never surfaced or logged: it distinguishes "no such user"
      // from "wrong password", which is an account-enumeration oracle.
      throw new ProviderError(mapStatus(response.status, onRejection), "sign-in was refused");
    }

    const parsed = TokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ProviderError("unavailable", "the identity provider returned an unusable response");
    }
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresIn: parsed.data.expires_in,
    };
  }

  return {
    signInWithPassword(email, password) {
      return tokenGrant("password", { email, password }, "invalid-credentials");
    },

    async signUp(email, password, displayName) {
      // Not `tokenGrant`: `/signup` is the one provider call whose success may legitimately
      // carry no tokens, so a helper that insists on parsing a token response would turn the
      // confirmation-required deployment into a spurious "unusable response".
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiUrl}/signup`, {
          method: "POST",
          headers,
          // `data` becomes provider user metadata. It is user-supplied and stays that way:
          // nothing downstream reads it as an authorization input, and the mirrored profile
          // is written from the verified email rather than from this.
          body: JSON.stringify({ email, password, data: { display_name: displayName } }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new ProviderError("unavailable", "the identity provider could not be reached");
      }

      if (!response.ok) {
        // The body is never surfaced. GoTrue distinguishes "already registered" from a
        // rejected password, and passing that through would hand the caller an
        // account-enumeration oracle the route then has to un-leak.
        throw new ProviderError(mapStatus(response.status, "invalid-credentials"), "sign-up was refused");
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

    async requestMagicLink(email, codeChallenge, redirectTo) {
      // S256 only. Offering `plain` would let anyone who sees the authorization request
      // reconstruct the verifier, which is the whole thing PKCE prevents.
      let response: Response;
      try {
        response = await fetchImpl(
          `${config.apiUrl}/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              email,
              code_challenge: codeChallenge,
              code_challenge_method: "S256",
            }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch {
        throw new ProviderError("unavailable", "the identity provider could not be reached");
      }
      if (!response.ok) {
        throw new ProviderError(
          mapStatus(response.status, "invalid-credentials"),
          "the link could not be sent",
        );
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
