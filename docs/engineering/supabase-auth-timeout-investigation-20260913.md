# Staging Auth timeout investigation

**Open provider/release blocker.** Read-only investigation, September 13, 2026. Project `kdqnfruwgocfqwpbpuxo`; no Production access, provider configuration change or account cleanup. This packet is prepared for review; it has not been sent to Supabase.

| Occurrence | Application evidence | Provider evidence |
| --- | --- | --- |
| Signup, 15:25 UTC | Preview run 34765409926, SHA `9e31175acba752af012b312d7c4adca87dd631fb`; second synthetic signup returns 503 at 15:25:11.719Z. Trace `01a09b5f-3e1e-7c9e-9cac-69dc18be392b`; structured event explicitly records upstream HTTP 504. | Gateway log `42aac198-23e9-4fb8-8954-7d266864ea96`, 15:25:06Z, POST `/auth/v1/signup`, status 504; `x_sb_error_code` null. |
| Password sign-in, 15:40 UTC | Preview run 34766162197, SHA `10184021b747491c6b0c5ee32dd32968d51dbb4b`; valid-password sign-in returns 503 at 15:40:13.659Z. Trace `01a09b6d-0014-70fa-bf63-5b86bbbc2a41`. | Gateway log `786fcd07-4445-4422-b801-dbf75b480639`, 15:40:08Z, POST `/auth/v1/token`, status 504. Correlated by the exact path/time and isolated failure in the test run. |

The first failure's application log appears twice with the same trace and status; that is one distinct failing request, not evidence of two failures. The second run's existing diagnostic collector searches only signup errors, so its zero-record result does not mean sign-in was healthy.

For these occurrences, the immediate cause is a provider HTTP 504, correctly surfaced by the application as temporary unavailability. This is stronger than observing a client timeout: the signup adapter recorded an actual HTTP response. The underlying cause inside Supabase is unresolved. No evidence yet proves whether its gateway, Auth upstream, network or a transient capacity issue caused the timeout.

A later read-only database snapshot shows fourteen backends, including one idle app_user/Supavisor connection, versus max_connections 60 and three reserved superuser slots. It does not show current saturation; it cannot rule out pressure during either earlier request. No sessions were terminated, database settings changed, or broad logs containing credentials retained.

Historical duplicate-signup failures in runs 34700604009 and 34701304066 remain unresolved. The latter ran September 12 at 15:08–15:10 UTC, before the free plan's retained one-day log window at this inspection. Current upstream signup source ordinarily returns 422 for an already confirmed account with autoconfirm enabled. That explains expected behavior, not the historical failure. Both new runs correctly return 204/202/202/429/429 for the duplicate-signup sequence.

The signup failure produced 54/57 acceptance. The old harness then sent an empty foreign-household selector, which became an own-household read; that 200 is not proof of a tenancy escape. The corrected harness refuses that request until both distinct authenticated fixtures exist. Its three negative controls pass. The corrected run has valid tenant fixtures but fails 52/57 after password sign-in fails, followed by four dependent session assertions.

Closure requires provider-side diagnosis using these request windows, a verified mitigation where needed, regression tests for any application change, and repeated controlled end-to-end evidence under realistic staging load. A green retry alone does not resolve the issue. Do not add automatic password sign-in after ambiguous signup, expose account-existence/provider details, or change 503 into 202 merely to make a test green.

References: [signup failure workflow](https://github.com/MichalKuderski/AutoBureau/actions/runs/34765409926), [sign-in failure workflow](https://github.com/MichalKuderski/AutoBureau/actions/runs/34766162197), [current upstream signup implementation](https://github.com/supabase/auth/blob/master/internal/api/signup.go), [Supabase logs documentation](https://supabase.com/docs/guides/platform/logs).

## Application resilience verification, September 13, 20:20 UTC

All five provider operations remain single-attempt with a ten-second deadline. Allow-listed diagnostics now distinguish an upstream HTTP response, a local deadline, a transport failure and an unusable response. Only numeric status/duration, a fixed failure category and a validated provider request UUID are retained. Bodies, credentials, arbitrary headers and URLs are excluded. Preview diagnostics now inspect both signup and sign-in failures.

Signup/sign-in temporary failures return the existing coarse 503 with `Retry-After: 15`, no redirect and no cookie overwrite. The application does not silently repeat an ambiguous credential mutation. Real local HTTP-provider and PostgreSQL tests prove a 504 creates no application bootstrap/audit rows; an explicit successful retry and its repeat produce one user/profile/household/owner/entitlement and five bootstrap audits. Refresh 504 retains cookies, terminates its redirect cycle and makes one provider request. Enumeration-safe responses are unchanged.

Validation: 38 affected provider/diagnostic unit checks, 40 auth-session integration checks through app_user on disposable PostgreSQL 18, typecheck and affected lint pass. CI retains PostgreSQL 16. These are resilience regressions, not provider root-cause closure or stable-staging end-to-end evidence. Provider-side causal investigation and final candidate acceptance remain open.

## Additional stable-staging smoke failure, September 13, 22:06 UTC

The stable domain's smoke run completed at approximately 22:06:05 UTC with **16/17**. Synthetic invalid-password sign-in returned **503**. The historical smoke harness did not retain response classification, elapsed time or request ID, so this occurrence cannot yet be causally attributed to an upstream 504. Its generic hint that AUTH configuration is unset was not evidence of a configuration change. The stable application had not been promoted to the launch branch.

A manually formed follow-up at 22:08:18 UTC omitted the required CSRF header and returned 403. This was an invalid diagnostic probe and is not provider-health evidence. A correctly formed single follow-up at 22:13:21 UTC returned the expected application 401 after 2,603 ms. Recovery on a later request does not resolve the earlier failure. No real account signed in and the controlled confirmation account was untouched.

The smoke harness now requires an exact 401 problem response for invalid credentials and 401 for unauthenticated household access. It rejects 500/502/504, redirects, unrelated JSON and throttling instead of allowing negative status comparisons to manufacture a green gate. Safe fixed diagnostics include time, duration, opaque trace, numeric retry delay and a coarse classification; arbitrary body/header values are excluded. Nineteen new negative controls plus the three existing tenant-fixture controls pass. A separate fixed-project, read-only CI collector resolves the stable alias, reads only that deployment's auth diagnostics, and verifies the assignment/protection are unchanged. It never builds, promotes or queries the separate Production application; it does not relax the Preview collector's guard.

The strengthened stable smoke passes 17/17 at 22:23 UTC; invalid sign-in takes 3,438 ms and returns 401. Read-only collector run 34786636939 successfully verifies unchanged stable assignment/protection and returns zero matching auth records. This is incomplete causal evidence, not an explanation of the 22:06 failure. The existing Preview collector successfully parses a later real failure, independently demonstrating the provider's current JSON wrapper is supported.

## New directly observed provider failure, September 13, 22:25 UTC

Preview run **34786603902**, source **a352d1c083d17b0d1282eb8ef4e59aa28ed5aada**, passes 17/17 smoke but fails **56/57 acceptance**. Wrong-password sign-in returns application 503 at 22:25:13.540Z. The matching structured log proves **upstream HTTP 504**, failure category `http`, **5,030 ms** duration, application trace `01a09cdf-cacb-7875-99cd-543f33318c3b`, and provider request ID `01a09cdf-cf92-7e3b-a9cc-e59dfdd0a8fa`. [Sanitized evidence](evidence/preview-auth-504-20260913-2225.json).

This is an actual upstream response before the application's 10-second deadline, not an AbortSignal deadline or an application retry. The password request is distinct from signup confirmation/email delivery; it does not establish that SMTP caused or explains these failures. Provider-side logs are still needed to distinguish gateway/Auth/DB/other upstream latency. The application intentionally returns one coarse transient error and does not retry credentials, create cookies, or expose upstream detail. Duplicate-signup semantics remain 204/202/202/429/429. No failed assertion was weakened and no green rerun substitutes for closure.

The 22:28 database snapshot has 15 backends against max_connections 60 and zero lock waiters. This rules out saturation only at that snapshot; it does not prove conditions during the earlier failed request. Hosted schema remains 13 completed migrations / zero rolled back, 21 forced-RLS tables / 27 policies, no ensure trigger and zero provider API table grants. The three expected successful synthetic signups bring households/entitlements to 167/167. No real financial or document data was ingested.
