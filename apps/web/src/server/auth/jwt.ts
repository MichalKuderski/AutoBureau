import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import { UUID_RE } from "@autobureau/contracts";

/**
 * Access-token verification (ADR-009 D3/D7).
 *
 * Provider-agnostic on purpose. Doc 14 commits to keeping auth JWT-compatible so a
 * migration to a dedicated GoTrue deployment or a WorkOS-style provider is possible
 * "without token-format change" — that promise is only real if the verifier names no
 * provider. Supabase populates the configuration; it does not appear in this file.
 *
 * Everything is checked explicitly rather than trusted from the token:
 *   signature   — against a key resolved from the JWKS, never from the token itself
 *   algorithm   — against a caller-supplied allowlist, never `alg` from the header
 *   issuer      — exact match
 *   audience    — exact match
 *   expiry      — and `exp` is *required*, because jose only validates a claim it finds
 *   subject     — must be a UUID, because it becomes `users.id`
 *
 * Failure is always a `TokenError` with a coarse reason. The reason is deliberately
 * coarse and the message never contains the token, a claim value, or a key: an auth
 * error that explains precisely why it failed is an oracle.
 */

export type TokenRejection =
  | "malformed"
  | "signature"
  | "expired"
  | "issuer"
  | "audience"
  | "algorithm"
  | "claims";

export class TokenError extends Error {
  override readonly name = "TokenError";
  constructor(
    readonly reason: TokenRejection,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown at construction, not at verification: misconfiguration must fail at boot. */
export class VerifierConfigError extends Error {
  override readonly name = "VerifierConfigError";
}

/**
 * Asymmetric only. A JWKS-backed verifier that also accepted HMAC would be vulnerable
 * to the classic algorithm-confusion attack — an attacker signs `HS256` using the
 * published public key as the shared secret, and a naive verifier accepts it. Excluding
 * symmetric algorithms at the type level removes the attack rather than documenting it.
 */
const ASYMMETRIC_ALGORITHMS: ReadonlySet<string> = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

/** Where signing keys come from: a JWKS endpoint in production, a literal set in tests. */
export type JwksSource = { readonly uri: string } | { readonly keys: JSONWebKeySet };

export interface JwtVerifierConfig {
  readonly jwks: JwksSource;
  readonly issuer: string;
  readonly audience: string;
  /** Pinned allowlist. Must be non-empty and asymmetric. */
  readonly algorithms: readonly string[];
  /** Seconds of clock skew tolerated. Defaults to 0 — strict until proven otherwise. */
  readonly clockToleranceSec?: number;
}

/** What a caller is allowed to learn from a token. Not the raw claims. */
export interface VerifiedPrincipal {
  /** `sub`, lowercased and validated as a UUID — this is `users.id`. */
  readonly userId: string;
  /** Seconds since the epoch. */
  readonly expiresAt: number;
  readonly issuedAt: number | undefined;
}

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedPrincipal>;
}

function assertConfig(config: JwtVerifierConfig): void {
  if (!config.issuer) throw new VerifierConfigError("issuer is required");
  if (!config.audience) throw new VerifierConfigError("audience is required");
  if (config.algorithms.length === 0) {
    throw new VerifierConfigError("at least one algorithm must be pinned");
  }
  for (const alg of config.algorithms) {
    if (!ASYMMETRIC_ALGORITHMS.has(alg)) {
      throw new VerifierConfigError(
        `${alg} is not an accepted algorithm; only asymmetric algorithms may verify against a JWKS`,
      );
    }
  }
  if ("uri" in config.jwks) {
    if (!config.jwks.uri) throw new VerifierConfigError("jwks.uri is required");
  } else if (!config.jwks.keys?.keys?.length) {
    throw new VerifierConfigError("jwks.keys must contain at least one key");
  }
}

function resolveKeys(source: JwksSource): JWTVerifyGetKey {
  return "uri" in source
    ? createRemoteJWKSet(new URL(source.uri))
    : createLocalJWKSet(source.keys);
}

/** jose's error taxonomy → our coarse reasons. Anything unrecognised fails closed. */
function translate(cause: unknown): TokenError {
  if (cause instanceof errors.JWTExpired) {
    return new TokenError("expired", "token has expired");
  }
  if (cause instanceof errors.JOSEAlgNotAllowed) {
    return new TokenError("algorithm", "token algorithm is not accepted");
  }
  if (cause instanceof errors.JWSSignatureVerificationFailed) {
    return new TokenError("signature", "token signature is not valid");
  }
  if (cause instanceof errors.JWKSNoMatchingKey || cause instanceof errors.JWKSMultipleMatchingKeys) {
    return new TokenError("signature", "no usable signing key for this token");
  }
  if (cause instanceof errors.JWTClaimValidationFailed) {
    if (cause.claim === "iss") return new TokenError("issuer", "token issuer is not accepted");
    if (cause.claim === "aud") return new TokenError("audience", "token audience is not accepted");
    return new TokenError("claims", "token claims are not acceptable");
  }
  if (cause instanceof errors.JWSInvalid || cause instanceof errors.JWTInvalid) {
    return new TokenError("malformed", "token is not a well-formed JWT");
  }
  return new TokenError("malformed", "token could not be verified");
}

export function createJwtVerifier(config: JwtVerifierConfig): JwtVerifier {
  assertConfig(config);
  // Resolved once: createRemoteJWKSet caches keys and coalesces concurrent fetches, so
  // rebuilding it per request would turn every verification into a network call.
  const keys = resolveKeys(config.jwks);
  const algorithms = [...config.algorithms];

  return {
    async verify(token: string): Promise<VerifiedPrincipal> {
      if (typeof token !== "string" || token.length === 0) {
        throw new TokenError("malformed", "no token supplied");
      }

      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms,
          clockTolerance: config.clockToleranceSec ?? 0,
        }));
      } catch (cause) {
        throw translate(cause);
      }

      // jose validates `exp` only when the claim exists, so a token that simply omits it
      // would otherwise verify and never expire.
      if (typeof payload.exp !== "number") {
        throw new TokenError("claims", "token has no expiry");
      }

      const subject = typeof payload.sub === "string" ? payload.sub.toLowerCase() : "";
      if (!UUID_RE.test(subject)) {
        throw new TokenError("claims", "token subject is not a user id");
      }

      return {
        userId: subject,
        expiresAt: payload.exp,
        issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
      };
    },
  };
}
