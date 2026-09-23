# Pellum pre-Codex continuation - September 19, 2026

> Historical v2 package notes. Native reconciliation and later fixes are recorded in [the September 20 local review](local-v2-review-20260920.md); package-era "not run" statements below describe the original package only.
This is a local review increment, not a launch release or a provider approval.
Base: codex/launch-foundations @ 7863ec89e1cfd35abb3dcd0132ba2ae1c42c6595.
US/English, one account holder managing household members, provisional Premium
USD 12/month or USD 99/year, Stripe TEST and Plaid Sandbox scope is unchanged.

## Implemented in this increment

1. Auth: explicit response projection; pending-user/token separation; bounded
   shared response reader; total chunk limit; manual redirect policy; resource
   cleanup; no automatic credential replay. See auth-response-hardening-20260919.md.
2. Plaid Sandbox: existing client now delegates to a tested fixed-host transport.
   Existing Zod token, owner-binding and response schemas remain in the client.
   Its four-route allow-list and sandbox-only configuration remain. Real 429s
   are classified without parsing an error body; 5xx/redirects remain temporary
   faults rather than being misclassified as account reconnect requirements.
   Body reads share auth's byte/chunk/deadline controls; cancellation cannot hold
   the request open. No endpoint or sandbox provider operation is enabled.
3. Stripe TEST foundations: server-bound recurring price validation for 1200 USD
   cents/month and 9900 USD cents/year. Checks reject live, inactive, wrong-price,
   wrong-product, wrong-currency, tiered, metered, transformed and wrong-interval
   prices. These are base-price guards, not final invoice or unit-economics proof.
4. Stripe event adapter: passes exact raw bytes to an injected OFFICIAL SDK
   constructEvent implementation with a 300-second tolerance; projects only
   own-account, matching-version TEST event routing data. Recognized events
   trigger reconciliation, never an entitlement grant. Unknown authentic TEST
   events are ignored. There is deliberately no HTTP endpoint or persistence.

## Stripe integration still required (do not skip)

Install a reviewed pinned Stripe SDK and lockfile under the project's normal
process. Bind the adapter to stripe.webhooks.constructEvent, using Buffer.from
on its Uint8Array input. Do NOT bind a JSON parser or a mock as the real verifier.
The SDK's cryptographic correctness was not tested by the adapter's injected tests.
The API version must exactly match the independently configured snapshot endpoint.
Read raw bytes with a bounded request reader before calling the adapter.

Before exposing an endpoint, implement: signature and real TEST-event fixtures;
transactional durable event inbox with unique event identity; owned customer and
household mapping; idempotent asynchronous processing via the existing outbox;
authenticated provider refetch/reconciliation for out-of-order events; entitlements
and cancellation/renewal/failure rules; server-only price selection; reauthenticated
portal access; crash/replay tests; configured endpoint secret and TEST provider
proof. A successful redirect, signed event, active subscription label or this price
guard alone never grants Premium. Caps/grace/trial policy must not be invented.
No live API key, real charge, product creation, or new provider account is included.

## Immediate native verification

Review the cumulative patch on an isolated local branch. Install the repository's
pinned dependencies with pnpm install --frozen-lockfile. Run new AND existing auth,
Plaid and billing Vitest tests, then pnpm lint, pnpm build, pnpm typecheck, pnpm test,
and pnpm test:integration. Integration must use disposable LOCAL PostgreSQL with
both admin and app_user roles. Never point the tests at hosted staging/production.
Do not infer route, cookie, bootstrap or tenant-isolation behavior from transport
unit tests alone. Add/execute real route/provider/DB failure cases for malformed,
truncated and oversized signup bodies: 503; no issued cookies; no bootstrap/audit
creation apart from separately expected rate-limit activity; one provider attempt;
explicit retry converges. Session/confirmation/refresh/duplicate regressions must
stay intact. Native Plaid client schemas and webhook cryptography must be rerun.

## Unchanged release blockers and ordered continuation

- Confirm the affected Supabase OAuth authorization's containment BEFORE management
  investigation. Then gather tightly scoped, redacted Auth/gateway/DB evidence for
  controlled fresh failures. Do not request or print credentials. Preserve failures;
  do not add a blind retry or reclassify errors to obtain a green acceptance run.
- The current Supabase changelog deprecates logs.all on September 23, 2026. Use the
  current logs endpoint and its ClickHouse syntax; do not paste old SQL into it.
  Health Advisors were added September 18. They may supply an additional diagnostic
  signal once management access is permitted, not root-cause or recovery proof.
- Confirm SNS subscription and a synthetic end-to-end alert receipt before the
  relevant queue/infrastructure gate closes. An UPDATE_COMPLETE stack is not proof
  that a human receives failures. No queue apply or continuous worker here.
- Document pipeline: quarantine/scan isolation, deployed dispatch, retry/DLQ,
  retention/reconciliation, deletion receipts, provenance, review and reminders.
  Do not mistake regex masking for proof that identifiers cannot leave for a model.
  Real documents/model processing stay OFF until the privacy boundary is proven.
- Recovery/MFA/export/deletion must be tested as complete tenant-safe lifecycles.
- Plaid's existing Sandbox client/webhook are foundations. Durable linking and
  encrypted token custody, sync, reconnect/disconnect, webhook replay, revocation
  and privacy evidence are still required. No Production or real financial data.
- Exact-candidate Preview/stable acceptance, founder staging acceptance, legal/
  provider/brand/domain requirements and rollback evidence remain separate gates.
  No merge with rollout consequences, Production access, live charging or DNS.

References (retrieved September 19):
https://docs.stripe.com/webhooks/signature
https://docs.stripe.com/webhooks
https://docs.stripe.com/api/prices/object
https://plaid.com/docs/api/items/
https://supabase.com/changelog
