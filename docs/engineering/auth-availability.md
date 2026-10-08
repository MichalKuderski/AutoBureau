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

## Single document navigation after password sign-in (October 2026)

The password form now replaces the document once after its successful sign-in
response, validating `next` again through `safeDestination`. This preserves history
replacement, reads the newly issued HttpOnly cookies, and rebuilds router and client
query caches. The prior `router.replace()` followed by `router.refresh()` produced
two overlapping server-layout renders in a local production-mode Next 15.5.22
probe: three trials started the second render 11–20ms after the first, which was
still awaiting a synthetic 1.8-second operation. This mechanism is demonstrated;
its responsibility for the hosted P2028 incident is not established.

A synchronous request ref blocks duplicate submissions before React commits the
button's disabled state. Unmount and pagehide invalidate the attempt and abort its
transport; completion also checks ownership and the current URL. A late response
cannot navigate or update a newer form. Abort is not server-side rollback: it may
not prevent session cookies or other already accepted sign-in work. Errors release
the lock for an explicit retry; successful document navigation holds it until exit.
The mode switch is disabled while submitting. Magic-link endpoint, request body,
non-enumerating confirmation and eventual callback navigation remain unchanged.
No auth/tenant/MFA/admission check, pool setting or timeout changed.

`sign-in-form.test.tsx` covers validated destinations, errors, magic links,
same-batch duplicates, late success/failure after unmount, newer attempts, changed
URL and simulated pagehide/restoration. The old implementation issues two POSTs
in the new synchronous-duplicate negative control.

Run the optional browser regression with installed Playwright and Chromium:

```bash
# If they are not already on module/default-browser lookup paths, set
# PLAYWRIGHT_MODULE to the installed module and CHROMIUM_EXECUTABLE to the binary.
node scripts/sign-in-navigation-browser.mjs
```

The script builds a temporary production-mode Next app using the actual form and
UI utilities. It binds a random loopback port, rejects browser requests to other
origins and uses only synthetic endpoint responses and session markers. It tests
cached signed-out/prior-user state, exactly one submission/document/layout,
HttpOnly marker delivery, Back/history and destination queries, a failed
destination load followed by manual reload, departure during a pending sign-in,
error retry and magic-link confirmation. It writes synthetic logs/results to the
printed temporary directory and stops its server and browser.

This optional harness is not part of CI's unit runner and installs no dependencies.
Its endpoints/layout/providers intentionally replace production middleware,
Supabase and the database; passing it does not prove hosted auth, tenant policy,
BFCache behavior or elimination of database timeouts. Real BFCache restoration is
not claimed from the unit pagehide simulation. Full CI must still pass, followed
by the existing required reviewer gate before an isolated preview can be tested.

## Dashboard shell scheduling and billing recovery (October 2026)

BillingBanner mounts outside DashboardScreen, and the command palette is a sibling
of AppShell. Both previously bypassed the dashboard read scheduler. Billing now
schedules in its shared hook (including the settings observer), and interactive
obligation search uses the same QueryClient queue. Reads retain captured household
scope and AbortSignal. No mutations, server admission checks or provider gates move.

A failed billing read now shows an explicit status warning instead of silently
hiding. Transient failure permits one manual retry; billing still has no automatic
retry. A 401 offers sign-in, and 403 suppresses retry. Failed refreshes and loss of
owner role hide cached billing details/actions. Billing-OFF responses do not offer
provider actions. Scheduling is local to the QueryClient: other tabs, server work,
route transitions and mutations are not globally serialized, and a slow billing
read can delay panels. Closing search alone does not promise transport cancellation.

The full-shell regression mounts the real shell, dashboard, palette and an extra
billing-settings observer. It covers refresh/search overlap, explicit recovery,
queued household cancellation with an unsettled transport, role changes and stale
401/403/500 responses. Collection continuation remains covered by the existing
collection tests; the shell fixture uses exhausted pages.

`node scripts/dashboard-shell-browser.mjs` runs an optional production-mode Next
fixture importing those same components, using the Playwright/Chromium variables
above. Browser requests are restricted to loopback; every API response is synthetic.
It asserts one initial billing request, visible failure, one explicit recovery
request despite duplicate clicks, shared serialization during refresh/search, and
no provider actions for billing OFF. This is not hosted performance or auth/RLS
acceptance, and the underlying P2028 cause remains unresolved.
