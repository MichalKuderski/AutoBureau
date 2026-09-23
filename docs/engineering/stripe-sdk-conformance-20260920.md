# Stripe SDK conformance: local development only

The v2 package injected a verifier function, leaving actual SDK signature behavior
unproved. This increment pins `stripe@22.6.2` as a **devDependency** for offline
native Vitest fixtures. Registry metadata identifies the official stripe-node
repository, MIT license, Node >=18, no runtime dependencies and no install hook.
The lockfile adds only this package and its already-present optional Node types;
no existing resolved dependency is upgraded.

Only `stripe-sdk.test.ts` imports Stripe. It calls the SDK's static webhook helpers
without an API client or API key. `generateTestHeaderString` creates synthetic
fixtures and `constructEvent(Buffer.from(bytes), header, secret, 300)` verifies
them. No custom HMAC implementation, provider request or webhook endpoint exists.

Sixteen native cases cover exact Buffer/Uint8Array payloads, content tampering,
JSON reserialization, wrong endpoint secret, stale signatures, malformed/missing
headers, signed Live/wrong-version/Connect/context events, replay-as-notice and
ignored events. A further regression protects the adapter's byte snapshot:
`Buffer.slice()` shares memory, so the adapter now uses `new Uint8Array(rawBody)`.

This is a test-tool dependency decision under the approved local implementation
scope. PRD §12's runtime dependency constraint is not waived. Runtime SDK adoption,
independently configured endpoint/version/secret binding, durable inbox, customer
ownership, provider refetch, outbox, entitlement reconciliation and actual Stripe
TEST lifecycle evidence remain required before exposing an endpoint. No legal or
Production approval is inferred. Signature conformance does not grant Premium.

References reviewed September 20:
- [Official SDK](https://github.com/stripe/stripe-node)
- [Exact package metadata](https://registry.npmjs.org/stripe/22.6.2)
- [Stripe signature contract](https://docs.stripe.com/webhooks/signature)
