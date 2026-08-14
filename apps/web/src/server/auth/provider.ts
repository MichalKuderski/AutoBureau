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
 */

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

export interface AuthProvider {
  signInWithPassword(email: string, password: string): Promise<SessionTokens>;
  refresh(refreshToken: string): Promise<SessionTokens>;
  signOut(accessToken: string): Promise<void>;
  /** Ask the provider to email a link that will return an authorization code. */
  requestMagicLink(email: string, codeChallenge: string, redirectTo: string): Promise<void>;
  /** Redeem that code. Useless without the verifier that produced the challenge. */
  exchangeCode(authCode: string, codeVerifier: string): Promise<SessionTokens>;
}

function mapStatus(status: number, fallback: ProviderRejection): ProviderRejection {
  if (status === 400 || status === 401 || status === 403) return fallback;
  if (status === 429) return "rate-limited";
  return "unavailable";
}

export function createGoTrueProvider(
  config: AuthConfig,
  fetchImpl: typeof fetch = fetch,
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
      });
    } catch {
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
        // origin even when the provider is unreachable.
        await fetchImpl(`${config.apiUrl}/logout`, {
          method: "POST",
          headers: { ...headers, authorization: `Bearer ${accessToken}` },
        });
      } catch {
        /* deliberately swallowed — see above */
      }
    },
  };
}
