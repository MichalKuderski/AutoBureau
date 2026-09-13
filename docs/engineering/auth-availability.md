# Signing-key availability

Post-merge staging had a 503 signup and an authenticated dashboard redirect during a signing-key fetch. Neither proves a particular provider failure; the old response path hid key-fetch failures as malformed credentials and the signup provider branch emitted no trace.

The launch branch shares remote JWKS resolvers by trusted configured URL within each runtime. jose retains its 10-minute maximum key age and 30-second unknown-key cooldown. One read-only key lookup may retry once after failure; each network attempt has the existing five-second bound. Credential redemption is never retried. A cold runtime still needs the provider; no stale-key or unverified-token fallback exists.

If verification cannot reach a usable key service, middleware returns 503 with no-store, a correlation ID and a retry hint. It neither redirects nor changes session cookies. The API boundary makes the same distinction. Invalid, expired, forged and wrong-issuer tokens retain their original rejection paths. Server-render failures after middleware reach the existing retry error boundary rather than being converted to a sign-in redirect.

Regression evidence covers concurrent cold calls from separate verifiers, URL isolation, transient/permanent failures, hung requests, recovery, rotation, expired caches, signature/claim negative controls and cookie-preserving middleware responses. A full exact-SHA staging run remains required; local tests do not close the previously observed staging availability gate.

Reference: jose 6.2.8 [remote JWKS options](https://github.com/panva/jose/blob/v6.2.8/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md).

A separate regression reproduced on local PostgreSQL 18: the old `DELETE ... WHERE id IN (SELECT ... LIMIT 100 FOR UPDATE SKIP LOCKED)` removed all 150 expired fixtures. The query now selects the batch once in a MATERIALIZED CTE before deleting its IDs. The existing lower-bound assertion was retained, not relaxed. PostgreSQL 16 CI is still required. No hosted database, migration, role or policy was changed. [PostgreSQL CTE materialization](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION) explains the evaluation boundary.

## CI generation ordering (September 12)

CI at launch head 4077c36 passed the build but failed the following parallel typecheck with missing PrismaClient exports. The DB typecheck ran `prisma generate` while the web typecheck was resolving that same generated client. Generation can replace those files, so it must not run concurrently with a consumer.

The DB build remains the single owner of generation. Its Turbo task is uncached because the generated client is written under node_modules, outside the declared dist outputs. The DB typecheck depends on that build and only runs TypeScript. Web consumers already depend on the DB build through `^build`. This ordering also regenerates the client after an install when dist artifacts happen to be cached. No type errors are suppressed and no dependency versions changed.
