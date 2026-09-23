# Auth response hardening - September 19, 2026 (v2)

> Historical v2 package notes. Native reconciliation and later fixes are recorded in [the September 20 local review](local-v2-review-20260920.md); package-era "not run" statements below describe the original package only.
Development patch against codex/launch-foundations at
7863ec89e1cfd35abb3dcd0132ba2ae1c42c6595. Uncommitted and undeployed. NO-GO remains.
This replaces the earlier six-file local package; do not apply both cumulative patches.

## Changes

Unreadable successful signup responses previously became confirmation-required.
The adapter now requires either a complete token response or a UUID-bearing bare
user with no token fields. Pending and obfuscated duplicate users take the same
path. Email, identities and user metadata are not authorization inputs. A failed
read remains ambiguous: it neither proves account creation failed nor permits an
automatic repeat of signup/password sign-in. Existing routes render a coarse 503.

The small transport-response projection is now in provider-shape.ts. It has no
runtime dependencies and projects only accessToken, refreshToken and expiresIn.
The expiry must be a positive safe integer (stricter than the former ordinary
integer check). This is not a domain-schema replacement; Zod remains elsewhere.
Existing native provider and signup regressions must run before merge.

Auth and Plaid share server/http/provider-body.ts. The auth provider-body.ts path
re-exports it for compatibility with the first local patch. The reader bounds actual
UTF-8 stream bytes to 64 KiB, total chunks to 65,537, and body consumption to the
original request signal. The chunk ceiling closes a gap in byte-only limits:
empty chunks can otherwise consume unbounded work and starve the timer. A normal
byte-by-byte response at the full byte limit still passes. Malformed JSON/UTF-8,
broken streams, oversized responses and timeouts fail without retaining payloads.
Readers and abort listeners are released; remote cancellation is not awaited.

All auth POSTs explicitly disable redirect following and caching. An upstream
redirect cannot forward a password, refresh token, authorization code, OTP hash
or publishable key. Best-effort local sign-out remains best-effort. No automatic
credential retries, alternate authentication, cookie changes or database migrations.

## Verification boundaries

The v2 package records 233 isolated behavior tests, including actual loopback HTTP
requests and the previous 44 provider cases that had not been executed. Only test
registration is adapted from Vitest to node:test; production modules are used as
written. No Zod, SDK, fetch or database substitute is used for the auth transport.
Plaid transport tests use a fetch seam and exercise its real shared reader. Stripe
adapter tests inject the official-verifier interface; actual Stripe SDK signature
verification has NOT been run. Read the package validation report for exact scope.

Seven deliberate mutations are detected by failing assertions, with no cancelled
tests: byte bound, chunk bound, auth redirect fence, pending-user token fence, safe
session lifetime, Plaid route allow-list, and Stripe TEST price restriction.
Seven dependency-free production modules pass strict TypeScript checks with
noUncheckedIndexedAccess, exactOptionalPropertyTypes and noImplicitOverride.
This does NOT substitute for a full application build or native integration suite.

## Retained gates

The observed September 13 upstream 504 after 5,030 ms remains unexplained. This
patch does not diagnose Supabase, undo the credential incident, or prove hosted
reliability. Management investigation awaits confirmation of OAuth containment.
Historical logs may have expired. A later green run does not close a prior failure.

The GitHub baseline's CI 34789814668 and Preview workflow 34789814593 were observed
successful at the BASE SHA. They say nothing about this uncommitted patch.
Native full lint/build/typecheck/unit, local PostgreSQL/RLS tests, and controlled
candidate Preview acceptance remain required. No stable promotion or production
operation is part of this increment. Rollback is a code revert; it restores the
previous response-handling defects and is not itself a release endorsement.

References:
- https://github.com/supabase/auth/blob/master/internal/api/signup.go
- https://nodejs.org/api/globals.html#class-abortsignal
- https://developer.mozilla.org/en-US/docs/Web/API/Response/json
- https://supabase.com/changelog (logs.all removal on September 23, 2026)
