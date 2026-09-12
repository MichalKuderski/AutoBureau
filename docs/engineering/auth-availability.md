# Signing-key availability

Post-merge staging had a 503 signup and an authenticated dashboard redirect during a signing-key fetch. Neither proves a particular provider failure; the old response path hid key-fetch failures as malformed credentials and the signup provider branch emitted no trace.

The launch branch shares remote JWKS resolvers by trusted configured URL within each runtime. jose retains its 10-minute maximum key age and 30-second unknown-key cooldown. One read-only key lookup may retry once after failure; each network attempt has the existing five-second bound. Credential redemption is never retried. A cold runtime still needs the provider; no stale-key or unverified-token fallback exists.

If verification cannot reach a usable key service, middleware returns 503 with no-store, a correlation ID and a retry hint. It neither redirects nor changes session cookies. The API boundary makes the same distinction. Invalid, expired, forged and wrong-issuer tokens retain their original rejection paths. Server-render failures after middleware reach the existing retry error boundary rather than being converted to a sign-in redirect.

Regression evidence covers concurrent cold calls from separate verifiers, URL isolation, transient/permanent failures, hung requests, recovery, rotation, expired caches, signature/claim negative controls and cookie-preserving middleware responses. A full exact-SHA staging run remains required; local tests do not close the previously observed staging availability gate.

Reference: jose 6.2.8 [remote JWKS options](https://github.com/panva/jose/blob/v6.2.8/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md).
