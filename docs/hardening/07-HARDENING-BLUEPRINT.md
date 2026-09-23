# AutoBureau Hardening Blueprint

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Status:** **Authoritative work queue** for the next implementation phase.
**Supersedes:** nothing. Synthesises audits 00–06 in `docs/hardening/`.

---

## How to read this

Every task carries: **ID · priority · description · files · dependencies · risk · tests ·
change type · model**.

**Change type** — `Mechanical` (the shape of the change is already determined; judgment is in
execution) or `Architectural` (the change decides something, and the decision outlives the code).

**Category and model** — mapped to real model IDs so the queue is directly actionable:

| Cat | Meaning | Model | Effort |
|---|---|---|---|
| **A** | Mechanical implementation | `claude-sonnet-5` (or `claude-opus-5`) | `high` |
| **B** | Significant engineering change | `claude-opus-5` | `xhigh` |
| **C** | Architectural / security decision | `claude-opus-5` | `max` |

`xhigh` is the recommended setting for most coding and agentic work; reserve `max` for tasks
where correctness matters more than cost — which is exactly the C category. A-tasks are safe to
delegate; **C-tasks should not be delegated without the audit context in this directory.**

**This file is the single work queue.** Do not create a parallel task list — `CLAUDE.md`'s own
warning about two lists drifting applies here.

---

## The governing judgment

**The architecture is sound. Do not rewrite it.** The foundation — RLS tenancy, the `/v1`
boundary ordering, PKCE, the contracts package, the design system — is better than the product
stage requires and is verified. What is missing is the middle of the system and the operational
floor.

**The dominant defect class is not bugs. It is dishonesty.** 31 controls provably do not do what
they say. Sign-out does not sign out. The 2FA toggle protects nothing. Deletion deletes nothing.
Most of Phase 0 is therefore *deletion of false claims*, not construction — cheap, low-risk, and
the single largest available trust win.

**Two tasks gate everything else:** production observability (nothing is diagnosable without it)
and the identity lifecycle (no user can currently enter the product).

---

# Phase 0 — Must-fix blockers

*Things that make the application unreliable, unsafe, or misleading. Nothing here may ship or be
demonstrated externally in its current state.*

### P0-01 · Enable production error logging with redaction
| | |
|---|---|
| **Priority** | **Blocker** — gates diagnosis of every other task |
| **Description** | Every server log is gated behind `NODE_ENV !== "production"`, so production failures leave no record. Add a structured logger that runs in production, plus redaction (never log tokens, cookies, provider bodies, `item_secrets`). Wire error reporting with correlation IDs. |
| **Files** | `server/http/route.ts:135` · `app/v1/auth/sign-in/route.ts:86,104` · new `server/observability/*` · `next.config.ts` |
| **Dependencies** | None |
| **Risk** | **Medium** — redaction must be designed alongside, or this becomes a PII-in-logs finding |
| **Tests** | Assert no log line contains a token, cookie header, or provider body. Assert a thrown handler error produces exactly one structured record. |
| **Type** | Architectural (log taxonomy + redaction policy) |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P0-02 · Sign-out must terminate the session
| | |
|---|---|
| **Priority** | **Blocker** — highest security severity in the product |
| **Description** | Sign-out is `<Link href="/sign-in">`. Cookies stay valid and `provider.signOut()` is never reached, so the refresh token lives 30 days. On a shared household device the next person is inside the account. Convert to a `<button>` posting to `/v1/auth/sign-out` via `apiFetch`, then `router.replace` + `refresh()`. |
| **Files** | `components/layout/nav.tsx:153-163` |
| **Dependencies** | None — endpoint exists, CSRF-protected, tested |
| **Risk** | **Low** — accepted trade-off: a button loses middle-click/new-tab. Correct loss for an action. |
| **Tests** | E2E: sign in → sign out → `/dashboard` redirects to sign-in. Integration: cookies cleared even when the provider errors. |
| **Type** | Mechanical |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` (security-critical despite small diff) |

### P0-03 · Remove the fictional two-step verification toggle
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | `useState` boolean + toast claiming "You'll be asked for a code on new devices." No MFA exists anywhere. It causes users to *lower their guard* on an account holding identity documents. Remove, or render disabled with honest copy. |
| **Files** | `app/(app)/settings/profile/profile-settings.tsx` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | Assert no enabled control claims MFA. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-04 · Stop claiming deletion and export happened
| | |
|---|---|
| **Priority** | **Blocker** — regulatory exposure once real users exist |
| **Description** | Both terminate in a toast ("Deletion scheduled… We've emailed you the details"). No request, no email, no scheduling. Disable with honest copy or route to support until the cascade exists. |
| **Files** | `app/(app)/settings/privacy/privacy-settings.tsx` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | Assert the confirm action makes a request or does not claim completion. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-05 · Remove non-functional OAuth buttons
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | "Continue with Google/Apple" call `router.push(next)`. With auth configured, middleware bounces to `/sign-in` — a silent failure with no message. Remove or disable until OAuth is wired. |
| **Files** | `app/(auth)/oauth-options.tsx` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | E2E: no auth control navigates without establishing a session. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-06 · Wire the magic-link form to its existing endpoint
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | The form `setTimeout`s and claims "We've sent a sign-in link… expires in fifteen minutes." `POST /v1/auth/magic-link` exists with 40 passing tests and is never called. This is the wedge persona's primary path. |
| **Files** | `app/(auth)/sign-in/sign-in-form.tsx:82-90` |
| **Dependencies** | Requires `AUTH_*` config to verify end to end — sequence after P1-01 if no provider exists yet |
| **Risk** | **Low** — replacing a timer with the call it was written for |
| **Tests** | Integration: form posts with CSRF header; 204 renders confirmation; provider error surfaces without enumerating. |
| **Type** | Mechanical |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P0-07 · Stop claiming documents were received
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | `/documents/upload` discards files and toasts "N documents received". The Documents drawer is worse — argument ignored, **no toast at all**, zero feedback. No storage backend exists. Disable both with honest copy. |
| **Files** | `app/(app)/documents/upload/upload-screen.tsx:43-50` · `app/(app)/documents/documents-screen.tsx:~213` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | Assert the dropzone does not report success without a request. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-08 · Show the real forwarding alias, or none
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | The alias is synthesised client-side (`h-${id.slice(0,6)}@in.autobureau.com`) while the real `emailAlias` sits unused in the provider. Users are told to forward sensitive mail there, and to copy it. Render `household.emailAlias`; when null, an explicit "not yet available" state. |
| **Files** | `app/(app)/documents/upload/upload-screen.tsx:25` |
| **Dependencies** | None — value already in `ActiveHousehold` |
| **Risk** | **Low** |
| **Tests** | Assert no user-visible identifier is computed client-side. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-09 · Make billing read-only from the real plan
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | Local `useState` + toast "You're on Premium"; hardcoded `docsUsed = 7`. The sidebar reads the real `entitlements.plan`, so the screen can say Premium while the nav says Free simultaneously. Render `household.plan`; remove the fake meter; replace upgrade with a waitlist/contact path. |
| **Files** | `app/(app)/settings/billing/billing-settings.tsx` |
| **Dependencies** | None |
| **Risk** | **Low** |
| **Tests** | Assert plan displayed equals `household.plan` from the server. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-10 · Move encryption claims to commitment tense
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | Five surfaces state field-level encryption as present-tense fact. **No encryption code exists**; ADR-007 is unimplemented and `item_secrets` is never written. This is the claim most likely to be quoted back in a security review. |
| **Files** | `settings/privacy/privacy-settings.tsx:42,100` · `household-screen.tsx:240` · `documents/upload/upload-screen.tsx:87` · `onboarding/document/document-step.tsx:81` |
| **Dependencies** | None |
| **Risk** | **None** — copy only |
| **Tests** | Copy review checklist item (see the design-system checklist, §Truthfulness). |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-11 · Disable the four dead buttons
| | |
|---|---|
| **Priority** | High |
| **Description** | "Change password", "Sign out everywhere else", "Add someone", "Add item" are enabled `<Button>`s with **no `onClick`**. Clicking produces nothing — no toast, no error, no disabled state. "Add item" is the Household screen's primary CTA. |
| **Files** | `profile-settings.tsx:79,100` · `settings/household-settings.tsx:124` · `household/household-screen.tsx:123` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | Lint/review rule: no enabled control without a handler. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-12 · Give the expired-session state a way to re-authenticate
| | |
|---|---|
| **Priority** | High |
| **Description** | A 401 renders "Your session ended — Sign in again", and `ErrorState` offers only "Try again", which fails identically. Add an optional primary action; for 401 link to `/sign-in?next=<path>`. |
| **Files** | `components/ui/error-state.tsx:16-60,63-70` |
| **Dependencies** | Pairs with P0-13 |
| **Risk** | **Low** for the link. (Automatic refresh-on-401 is deliberately deferred to P1-07.) |
| **Tests** | Unit: 401 renders a sign-in action carrying the current path. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-13 · Honour the `?next=` parameter after sign-in
| | |
|---|---|
| **Priority** | High |
| **Description** | Middleware builds `?next=` with an open-redirect guard (`safeDestination`); the form hardcodes `router.replace("/dashboard")` and never reads it. Deep links and mid-task expiry always land on the dashboard. |
| **Files** | `app/(auth)/sign-in/sign-in-form.tsx:103` · `app/(auth)/sign-in/page.tsx` |
| **Dependencies** | None — must reuse `safeDestination`, never re-implement |
| **Risk** | **Medium** — an open-redirect if the existing guard is bypassed. Reuse it. |
| **Tests** | `next=/obligations` lands there; `//evil.com`, `/\evil`, control chars, and `/auth/refresh` all fall back to `/dashboard`. |
| **Type** | Mechanical, security-adjacent |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P0-14 · Stop navigating users to routes that do not exist
| | |
|---|---|
| **Priority** | High |
| **Description** | Next's manifest confirms `/obligations/[id]` is the only dynamic route. The command palette links to `/documents/{id}` and `/household/{id}`; three of eight fixture notification links and the timeline's source links are also dead. **Interim fix: stop emitting the dead destinations.** Real routes land in P2-03. |
| **Files** | `components/patterns/command-palette.tsx:~110-135` · `lib/domain/fixtures.ts:543,578,597` · `components/patterns/timeline.tsx:104` |
| **Dependencies** | None |
| **Risk** | **Low** — removing results is reversible when P2-03 lands |
| **Tests** | Assert every `dynamicHref` destination matches a route in the manifest. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-15 · Resolve the CSP contradiction
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | `next.config.ts:5` claims "CSP is nonce-based in production"; the live header is `script-src 'self' 'unsafe-inline'`. The only reason is one inline theme script. **Either** implement a per-request nonce and drop `unsafe-inline`, **or** correct the comment and record explicit acceptance. Do not leave the claim standing. |
| **Files** | `next.config.ts` · `middleware.ts` · `app/layout.tsx:34` · `providers/theme-provider.tsx` |
| **Dependencies** | None |
| **Risk** | **Medium** — nonce plumbing can break the theme script or Next's own inline bootstrap; verify in production mode |
| **Tests** | Header assertion that `script-src` excludes `'unsafe-inline'`; E2E that theming applies before paint. |
| **Type** | **Architectural** — a security-posture decision |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P0-16 · Make clickable table rows keyboard-operable
| | |
|---|---|
| **Priority** | High |
| **Description** | `<tr onClick>` with no `tabIndex`, `role`, or `onKeyDown`. Document review — the core product loop — and household item detail are **mouse-only**. WCAG 2.1.1 failure. |
| **Files** | `components/ui/table.tsx:118-125` (+ consumers in `documents-screen.tsx:188`, `household-screen.tsx:182`) |
| **Dependencies** | None |
| **Risk** | **Low** |
| **Tests** | Keyboard-only test: Tab to a row, Enter opens the drawer. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-17 · Give the mobile nav drawer a real focus trap
| | |
|---|---|
| **Priority** | High |
| **Description** | The drawer declares `role="dialog" aria-modal="true"` with no focus trap and no Escape handler — an accessibility assertion that is false. `useFocusTrap` already exists and is used correctly by `Modal` and the command palette. |
| **Files** | `components/layout/app-shell.tsx:~75-90` |
| **Dependencies** | None |
| **Risk** | **Low** — reuses a tested hook |
| **Tests** | Focus does not escape while open; Escape closes. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P0-18 · Correct governing documents that are factually wrong
| | |
|---|---|
| **Priority** | High — cheap, and it protects every subsequent task |
| **Description** | `CLAUDE.md` states `apps/` is "not yet created"; it holds ~16,200 LOC and is the file instructing every future engineer and agent. Also correct the `next.config.ts` CSP comment (with P0-15). Factual corrections — **not** a PRD amendment. |
| **Files** | `CLAUDE.md` (Repository map, Current phase) · `next.config.ts:5` |
| **Dependencies** | P0-15 for the CSP wording |
| **Risk** | **None** |
| **Tests** | None |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

---

# Phase 1 — Foundation hardening

### P1-01 · Deployment configuration, environment promotion, rollback
| | |
|---|---|
| **Priority** | **Blocker** |
| **Description** | No Dockerfile, `vercel.json`, Terraform, or `fly.toml`. The app has never been deployed, so every production characteristic is unmeasured. Establish a target, env promotion, and a rollback story (which migration PRs are already required to state). |
| **Files** | new deployment config · `.env.example` · CI |
| **Dependencies** | None |
| **Risk** | **Medium** |
| **Tests** | A deploy that serves `/` and returns 503 on `/v1` until `AUTH_*` is set. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-02 · Identity lifecycle: household creation and membership
| | |
|---|---|
| **Priority** | **Blocker** — the product cannot admit a user |
| **Description** | Nothing creates a `households` or `household_users` row outside tests. A new user mirrors, resolves `no-membership` (403), and lands on an error boundary permanently. Decide and build: sign-up → mirror → create household + owner membership + entitlement row. |
| **Files** | new `/v1/households` POST · `server/identity/*` · `sign-up-form.tsx` · onboarding persistence · migration |
| **Dependencies** | P1-01 (to verify against a real provider) |
| **Risk** | **High** — touches `RequestContext`, the universal chokepoint |
| **Tests** | Integration: new principal → household created → membership resolves → dashboard reachable. Concurrency: two simultaneous first sign-ins converge on one household. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-03 · Active-household selection (multi-household)
| | |
|---|---|
| **Priority** | High |
| **Description** | `>1` membership without `X-Household-Id` → 400. `apiFetch` supports the option; no caller passes it. The caregiver wedge is exactly the persona with two households. Decide the representation (cookie vs route segment) and thread it through. |
| **Files** | `lib/api-client.ts:68` · `providers/household-provider.tsx` · `(app)/layout.tsx` · `server/auth/context.ts` (read-only) |
| **Dependencies** | P1-02 |
| **Risk** | **High** — chokepoint |
| **Tests** | Two memberships + header → correct scope. Header for a third household → 403, indistinguishable from "no such household". |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-04 · Establish `/v1` domain API conventions once
| | |
|---|---|
| **Priority** | **Blocker** for Phase 1 endpoint work |
| **Description** | One domain endpoint exists; ~13 are coming. Settle list envelope, cursor pagination, filter encoding, PATCH semantics, error mapping, and idempotency **before** they are decided thirteen times in a hurry. Record as an ADR. |
| **Files** | new ADR · `packages/contracts/src/*` · `server/http/route.ts` (extend, do not restructure) |
| **Dependencies** | None |
| **Risk** | **Medium** — cheap now, expensive later |
| **Tests** | Contract tests over the envelope and pagination. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-05 · Server-side idempotency
| | |
|---|---|
| **Priority** | High |
| **Description** | `apiFetch` sends `Idempotency-Key` on every unsafe non-DELETE request; **no server code reads it**, while the client comment claims double-taps cannot create duplicates. Implement key + request-hash + stored response with a TTL. `packages/contracts` already has canonical hashing. |
| **Files** | new `idempotency_keys` migration · `server/http/route.ts` · `packages/contracts/src/canonical.ts` (reuse) |
| **Dependencies** | P1-04 |
| **Risk** | **Low** now; **High** if deferred past the first write endpoint |
| **Tests** | Same key twice → one row, identical response. Same key, different body → conflict. |
| **Type** | Architectural |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-06 · Timeouts on every provider call
| | |
|---|---|
| **Priority** | High |
| **Description** | All three `fetchImpl` calls pass no `AbortSignal`. A hung GoTrue blocks sign-in, refresh, and magic-link until the platform timeout — a dependency outage becomes an availability outage. |
| **Files** | `server/auth/provider.ts:84,128,156` |
| **Dependencies** | None |
| **Risk** | **Low** — choose the value deliberately; too tight fails slow mobile networks |
| **Tests** | Provider stub that never resolves → bounded `unavailable`. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P1-07 · Refresh must distinguish outage from revocation
| | |
|---|---|
| **Priority** | High |
| **Description** | `/auth/refresh` clears both cookies on **any** failure, so a transient GoTrue 5xx signs out every active user simultaneously. `provider.ts` already classifies `unavailable` separately. **Preserve the structural loop guard** — retaining cookies retains the redirect trigger, so this needs a bounded retry or short-lived marker, designed *against* the guard rather than around it. |
| **Files** | `app/auth/refresh/route.ts:62-66` · `middleware.ts` (read-only) |
| **Dependencies** | P0-01 (to observe the behaviour) |
| **Risk** | **Medium–High** — the one place a careless change reintroduces a redirect loop |
| **Tests** | Provider 500 → cookies retained, **no loop**. Provider 400 → both cleared, next pass reaches sign-in. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-08 · Rate limiting on auth endpoints
| | |
|---|---|
| **Priority** | High |
| **Description** | Provider 429s are handled; AutoBureau enforces none of its own. Credential stuffing is bounded only by GoTrue's unverified limits, and magic-link abuse is invisible. |
| **Files** | `app/v1/auth/*` · new limiter · PostgreSQL-backed store, no Redis dependency (ADR-013) |
| **Dependencies** | P1-01 (infrastructure), P0-01 (to see it working) |
| **Risk** | **Low** |
| **Tests** | N+1 attempts → 429; limit is per-account, not global. |
| **Type** | Architectural |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-09 · Decide the `users` / `user_profiles` RLS posture
| | |
|---|---|
| **Priority** | High |
| **Description** | Verified: `app_user` reads **all** rows in both tables at any scope. Deliberate and documented, but the sole protection for every user's email is one application-layer `where`. Either add a `request.user_id`-keyed self-read policy (the pattern already exists and works) or accept explicitly with a CI fence plus a test. |
| **Files** | new migration **or** CI guardrail + integration test |
| **Dependencies** | None |
| **Risk** | **Medium** if adding a policy — `withIdentity` writes with no household in scope and must keep working |
| **Tests** | Cross-principal read of `users` under household scope → zero rows. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-10 · Handle the email-collision path in identity mirroring
| | |
|---|---|
| **Priority** | Medium |
| **Description** | Verified: `ON CONFLICT DO NOTHING` swallows the unique-email conflict; the follow-on FK rejects and rolls back (correctly, fail-closed). But the Prisma error matches no catch branch → **500**, unlogged in production. A user whose email exists under another provider `sub` gets an opaque error forever. |
| **Files** | `server/identity/mirror.ts:72` · `app/v1/auth/sign-in/route.ts:84-105` |
| **Dependencies** | P0-01 |
| **Risk** | **Low** |
| **Tests** | Two principals, same email, different `sub` → deterministic non-500, no partial write. **Absent from the 14 existing mirror tests.** |
| **Type** | Mechanical |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-11 · Contract tests for `provider.ts`
| | |
|---|---|
| **Priority** | Medium |
| **Description** | The only external integration and the only outbound dependency has **zero tests**, and its own header says provider compatibility is unverified. |
| **Files** | new `server/auth/provider.test.ts` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | Status→reason mapping (400/401/403/429/5xx); no provider body reaches a response or log; `should_create_user` behaviour on `/otp`. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P1-12 · Index and retention pass
| | |
|---|---|
| **Priority** | Medium |
| **Description** | Seven FKs have no covering index (verified): `obligations.item_id`, `obligations.member_id`, `items.member_id`, `items.vendor_id`, `items.source_document_id`, `household_members.user_id`, `households.created_by`. "Filter by person" seq-scans, and cascades take a scan under lock. Add a **partial** index on `outbox_events WHERE published_at IS NULL`. Decide `audit_log` retention. |
| **Files** | new migration |
| **Dependencies** | None |
| **Risk** | **Low** — use `CREATE INDEX CONCURRENTLY`; PR must state lock impact and rollback (CLAUDE.md rule) |
| **Tests** | `EXPLAIN` assertions on the member-filter query. |
| **Type** | Mechanical (migration discipline required) |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-13 · Outbox dispatcher
| | |
|---|---|
| **Priority** | High |
| **Description** | `outbox.ts` exports only `emit()` — **no claim query, no publish loop**, and nothing calls it. ADR-005's guarantee is currently about zero events. Build the claim (`FOR UPDATE SKIP LOCKED`) and the worker on the `app_dispatcher` role. Also the pre-agreed host for `/v1` if P1-17 demands it. |
| **Files** | `packages/db/src/outbox.ts` · new worker · deployment |
| **Dependencies** | P1-01, P1-12 |
| **Risk** | **Medium** |
| **Tests** | At-least-once delivery; two dispatchers never claim the same row; poison-message handling. |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-14 · Thin E2E tier
| | |
|---|---|
| **Priority** | High |
| **Description** | 459 tests, none crossing browser↔server. Most Phase 0 defects are exactly what a thin E2E suite catches and unit tests structurally cannot. Playwright and Chromium are already available. |
| **Files** | new `apps/web/e2e/*` · CI |
| **Dependencies** | P1-01, P1-02 |
| **Risk** | **Low** |
| **Tests** | Sign-in · **sign-out actually signs out** · protected-route redirect · session expiry + refresh · cross-tenant header rejection. |
| **Type** | Architectural (test strategy) |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-15 · CI fence against bare `PrismaClient`
| | |
|---|---|
| **Priority** | Medium |
| **Description** | CI fences provider SDKs and the dispatcher escape hatch, but not the invariant most exposed to ordinary feature work: constructing a `PrismaClient` instead of using `withHousehold`. |
| **Files** | `.github/workflows/ci.yml` |
| **Dependencies** | None |
| **Risk** | **None** |
| **Tests** | The guardrail is the test. |
| **Type** | Mechanical |
| **Cat** | **A** · `claude-sonnet-5` @ `high` |

### P1-16 · Collapse the `(app)` layout's four queries into one
| | |
|---|---|
| **Priority** | Medium |
| **Description** | Household, members, entitlement, and viewer profile are four round trips inside one pinned-connection transaction, on **every authenticated page render** — the hottest path in the product. Same transaction, same scoping, same behaviour; one round trip. |
| **Files** | `app/(app)/layout.tsx:92-112` |
| **Dependencies** | None |
| **Risk** | **Low** — behaviour-preserving; RLS still scopes it |
| **Tests** | Existing layout tests must pass unchanged; assert one query in the transaction. |
| **Type** | Mechanical |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-17 · Measure the connection-lifetime budget
| | |
|---|---|
| **Priority** | Medium |
| **Description** | Tenancy requires an interactive transaction, which pins a pooled connection, so concurrency is bounded by pool size rather than CPU. `scoped.ts` names the risk and pre-agrees the escape hatch. **It needs a number.** Instrument transaction duration and pool wait; set the alert that triggers relocation. |
| **Files** | `packages/db/src/scoped.ts` (instrumentation only) · observability |
| **Dependencies** | P0-01, P1-01, P1-16 |
| **Risk** | **Low** — measurement only. **Do not change the scoping mechanism.** |
| **Tests** | Load test at target concurrency; alert fires at threshold. |
| **Type** | Architectural |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

### P1-18 · Domain endpoints and the fixture→API cutover
| | |
|---|---|
| **Priority** | High — the largest single body of work |
| **Description** | Eleven of twelve hooks resolve from fixtures; every mutation is a `setTimeout` returning its argument. Build the endpoints, then replace the twelve hook **bodies**. **Signatures must not change** — all 14 screens depend on them and nothing else. |
| **Files** | new `/v1/*` routes · `lib/domain/queries.ts` (bodies only) · `packages/contracts` view models |
| **Dependencies** | P1-02, P1-03, P1-04, P1-05 |
| **Risk** | **High** — contain to `queries.ts`; the optimistic-update machinery already works and should be preserved |
| **Tests** | Per-endpoint integration + tenant isolation; screen tests unchanged (proving the seam held). |
| **Type** | **Architectural** |
| **Cat** | **C** · `claude-opus-5` @ `max` |

### P1-19 · Wire production error reporting
| | |
|---|---|
| **Priority** | High — closes audit 05 Gate B2 and unblocks P1-08's sign-off condition |
| **Description** | Register a production `LogSink` that forwards `level: "error"` records to Sentry, implementing ADR-014 **as amended by ADR-015**. Mechanism is ADR-015's: `@sentry/core` — an explicit `ServerRuntimeClient` + `createTransport`, never `@sentry/node`, never `@sentry/nextjs`, never `instrumentation.ts`, no OpenTelemetry runtime, automatic instrumentation and default integrations disabled (`integrations: []`), no global Sentry state. **Composed with `defaultSink`, never replacing it, and called first** — a throwing, rejecting, or absent Sentry path must never cost the local stderr record, which the composition asserts directly. The only payload is the application's already-redacted `LogRecord`; never `serverName`/`runtime` options, so no `server_name` or runtime context is forwarded. One variable, `SENTRY_DSN`, via Doppler; unset disables the sink silently, not an error. Sourcemap upload **off by default**. Flush is **application-bounded**, not the SDK's own timeout (ADR-015 D5): race `client.flush()` against a ref'd timer, invoked via the **function form** of `after()` inside a request scope (never the promise form), wrapped in `try/catch` covering both `E468` (no request scope) and `E91` (no `waitUntil`); fire-and-forget otherwise. Also required: (a) one **additive** export of `defaultSink` from `logger.ts`; (b) a CI fence in `.github/workflows/ci.yml` failing the build on any `@opentelemetry/*` or module-interception (`import-in-the-middle`, `require-in-the-middle`) package entering the lockfile (ADR-015 D2); (c) confirm `@sentry/core`'s actual configuration surface (e.g. `sendDefaultPii`'s deprecation) against ADR-015's evidence, and verify the Next.js production build bundles it cleanly — an explicit verification obligation, not assumed. **Not part of this task:** creating the Sentry project/DPA/US-region project or configuring the doc 10 §4 "new-issue spike" alert rule — operational console work per ADR-014/ADR-015, outstanding after merge; actual delivery in a deployed environment remains production-only verification. |
| **Files** | new `server/observability/sentry.ts` · `server/observability/logger.ts` (`defaultSink` export only) · `server/observability/index.ts` · `apps/web/package.json` · `.env.example` · `docs/architecture/09-infrastructure-and-deployment.md` §9.4 · `.github/workflows/ci.yml` (OTel/module-interception fence, ADR-015 D2) |
| **Dependencies** | P0-01 (the seam), ADR-014 (accepted), ADR-015 (accepted) |
| **Risk** | **Low** — additive; a broken or absent sink degrades to exactly today's behaviour |
| **Tests** | Every `error` record reaches the sink; no `warn`/`info` record does. `defaultSink` still receives the local record when the Sentry path throws, rejects, or 500s — the composition property, asserted directly. An unset DSN registers nothing and logs normally. No forwarded record contains an email, IP, token, cookie, provider body, secret, `server_name`, runtime context, or an ADR-013 bucket value. The flush is bounded even against an unresponsive transport — the case the SDK's own timeout does not cover — and cannot extend a request's latency; the `after()` call uses the function form and both `E468`/`E91` are handled. The CI fence fails when a forbidden OTel/module-interception package enters the lockfile. Existing redaction and observability suites stay green, and the production build bundles `@sentry/core` successfully. |
| **Type** | Mechanical (the architecture is ADR-014's, as amended by ADR-015) |
| **Cat** | **B** · `claude-opus-5` @ `xhigh` |

---

# Phase 2 — UX/UI polish

*All A-category unless noted. None blocks Phase 3.*

| ID | Pri | Task | Files | Deps | Risk | Tests | Cat |
|---|---|---|---|---|---|---|---|
| **P2-01** | High | Render nav badge counts — `badgeKey` is typed on 3 items and never read, so the "what needs me" signal is absent | `layout/nav.tsx:117-142` | P1-18 | Low | Count announced to AT, not a bare number | **A** |
| **P2-02** | High | Sync filters/search/tabs to the URL — zero `useSearchParams` in `app/`, so back navigation resets them and views are unshareable | `obligations-screen` · `documents-screen` · `household-screen` | — | Low | Back preserves filters; URL restores state | **B** |
| **P2-03** | High | Add `/documents/[id]` and `/household/[id]` routes (completes P0-14) | new routes · `command-palette` · fixtures | P1-18 | Low | Every `dynamicHref` matches the manifest | **B** |
| **P2-04** | High | Real household switcher — currently a static card named `HouseholdSwitcher` | `layout/nav.tsx:166` | P1-03 | Medium | Switching rescopes all data | **B** |
| **P2-05** | Med | Account menu on the avatar (Profile · Settings · Sign out) — users look for sign-out there; today it links to profile | `layout/top-bar.tsx:110` | P0-02 | Low | Keyboard-navigable menu | **A** |
| **P2-06** | Med | Three-state theme control — one click permanently loses OS "system" preference | `layout/top-bar.tsx:88-100` | — | Low | System restores OS following | **A** |
| **P2-07** | Med | Remove the 220 ms simulated latency | `lib/domain/queries.ts:30-36` | P1-18 | Low | Loading states still render | **A** |
| **P2-08** | Med | Terminology pass — one vocabulary across nav/headers/marketing; "entitlement" means two different things | UI copy | — | None | Copy review | **A** |
| **P2-09** | Med | Wire `useItem` and `useMarkNotificationsRead` (zero consumers); notifications use a separate local `Set` | `queries.ts` · `notifications-screen` | P1-18, P2-03 | Low | Read state persists | **A** |
| **P2-10** | Low | In-product back control in onboarding (browser back only today) | `onboarding/onboarding-shell.tsx` | — | Low | State preserved | **A** |
| **P2-11** | Med | Double-submit guards — `ObligationCard`'s button and every `ConfirmDialog` caller pass no `loading` | `obligation-card.tsx:123` · privacy/billing dialogs | P1-18 | Low | N rapid clicks → one mutation | **A** |
| **P2-12** | Med | Adopt the design-system consistency checklist in review/CI (audit 02) | `CLAUDE.md` · PR template | — | None | — | **A** |
| **P2-13** | Low | 404 hardcodes `⌘K` while the top bar platform-detects | `app/not-found.tsx` | — | None | — | **A** |

---

# Phase 3 — Subscription and entitlement

*Full design in `docs/hardening/06-*`. **Gated on G1** (OD-1/OD-2).*

| ID | Pri | Task | Files | Deps | Risk | Type | Cat |
|---|---|---|---|---|---|---|---|
| **P3-01** | High | Plan configuration, not hardcoded (PRD §19 F14) — resolve the 4-way pricing inconsistency (OD-2/OD-3) | new config · `billing-settings` · `landing-screen` | G1 | Low | Arch | **B** |
| **P3-02** | High | Entitlement row created with every household | `/v1/households` POST | P1-02 | Low | Mech | **A** |
| **P3-03** | High | `GET /v1/entitlements` — the single source the UI renders | new route | P1-04, P3-02 | Low | Mech | **A** |
| **P3-04** | High | Server-side cap enforcement → `402` + 80% warning; **over-cap documents queue, never discard** | `/v1` middleware · pipeline | P3-03 | Medium | Arch | **B** |
| **P3-05** | High | Transactional usage counting in the same `withHousehold` transaction as the write | `/v1` document routes | P3-04 | Low | Mech | **A** |
| **P3-06** | High | Stripe webhook: verify signature → dedupe on `stripe_event_id` → outbox → 200. Add to the exact-match public allowlist **deliberately** | new `/webhooks/stripe` · `public-routes.ts` | P1-13 | **High** — public route; signature replaces session auth | **Arch** | **C** |
| **P3-07** | High | Subscription mirror + the projection function, tested in isolation; reject events older than `lastEventAt` | new migration · projector | P3-06 | Medium | Arch | **C** |
| **P3-08** | High | Stripe hosted Checkout + Billing Portal (keeps SAQ-A; satisfies one-click cancel) | new routes · `billing-settings` | P3-07 | Medium | Arch | **B** |
| **P3-09** | Med | Reconciliation job for missed webhooks | dispatcher | P3-07 | Low | Arch | **B** |
| **P3-10** | Med | Billing UI on real state (completes P0-09) | `billing-settings.tsx` | P3-03, P3-08 | Low | Mech | **A** |
| **P3-11** | Med | Ratify or remove the four invented Premium features (OD-5) — they appear nowhere in the PRD | PRD or UI | Product | None | Mech | **A** |
| **P3-12** | High | Account deletion must cancel the subscription and remove Plaid items, or a deleted account keeps being charged | deletion cascade | P3-07 | Medium | Arch | **B** |

---

# Phase 4 — Plaid *(contingent — do not start)*

**Gate P4-00 must pass first.** Plaid does **not** violate the keel as written (credentials go to
Plaid, not here; read-only ≠ moving money) — it is a **scope and sequencing** decision.

| ID | Task | Blocking condition |
|---|---|---|
| **P4-00** | **GATE** — PRD §21 amendment moving Plaid out of v2, **and** ADR-011 authored (named by the PRD; does not exist), **and** subprocessor addition with a 30-day notice cycle | All three. **No engineering until then.** |
| **P4-01** | `plaid_items` schema; `access_token` encrypted via ADR-007 (**requires ADR-007 implemented first**) | P4-00, ADR-007 |
| **P4-02** | Link token + server-side exchange endpoints | P4-01 |
| **P4-03** | Webhook handling — same envelope discipline as Stripe | P1-13, P4-02 |
| **P4-04** | Sync worker in the dispatcher; never in a request | P4-03 |
| **P4-05** | Connection lifecycle UI (`login_required`, re-auth, errors) — never silent | P4-04 |
| **P4-06** | Disconnect → `/item/remove` **and purge derived facts**, not merely stop syncing | P4-05 |
| **P4-07** | Tier gating — **entirely open** (OD-7); do not invent | ADR-011 |

All Phase 4 tasks are **C** · `claude-opus-5` @ `max`.

---

# Phase 5 — Final product verification

| ID | Task | Deps | Cat |
|---|---|---|---|
| **P5-01** | E2E suite covering every Phase 0–3 flow end to end | P1-14 | **B** |
| **P5-02** | Security regression suite — Gates A–D of audit 05 as executable checks | P1-14 | **C** |
| **P5-03** | Accessibility audit (PRD G3 requires one): keyboard-only pass, AT pass, contrast | P0-16, P0-17 | **B** |
| **P5-04** | Load test against the P1-17 connection budget; confirm the alert threshold | P1-17 | **B** |
| **P5-05** | Manual verification script — the ten-minute onboarding rule (PRD G3), 5 usability sessions | Phase 2 | **A** |
| **P5-06** | Re-verify tenant isolation on the deployed environment with real RLS | P1-01 | **C** |
| **P5-07** | Governance reconciliation — TRACEABILITY, assumption registry, README vs shipped reality | All | **A** |

---

# DO FIRST

**The first ten tasks, in exact order.** Nine are Phase 0; together they remove every
trust-breaking falsehood in the product. **Eight require no backend at all.**

| # | Task | Why this position | Cat |
|---|---|---|---|
| **1** | **P0-01** Production logging + redaction | Nothing else is diagnosable without it. Every later task's failure mode is currently invisible | **B** |
| **2** | **P0-02** Sign-out actually signs out | Highest security severity: on a shared household device, sign-out currently hands over the account | **B** |
| **3** | **P0-03** Remove the MFA toggle | The only defect that makes users *less* safe by inducing false confidence | **A** |
| **4** | **P0-04** Deletion + export honesty | Regulatory exposure the moment a real user exists | **A** |
| **5** | **P0-10** Encryption claims → commitment tense | Five surfaces assert the product's load-bearing security claim; no encryption exists | **A** |
| **6** | **P0-09** Billing read-only from `household.plan` | Removes the self-contradicting screen (Premium and Free simultaneously) | **A** |
| **7** | **P0-07** Upload honesty (both surfaces) | Files are discarded while receipt is affirmed; the drawer gives no feedback at all | **A** |
| **8** | **P0-05** Remove OAuth buttons | The most prominent controls on both auth screens fail silently | **A** |
| **9** | **P0-11** Disable the four dead buttons | Zero-risk; removes the purest "did that work?" friction | **A** |
| **10** | **P0-15** Resolve the CSP contradiction | A control documented as present and absent. Decide: implement the nonce, or record acceptance | **C** |

**Sequencing note.** #1 first so the rest is observable. #2 is a genuine security fix, not
cosmetics. #3–#9 are almost entirely deletion — they convert the product from *misleading* to
*candidly incomplete*, which is the posture the onboarding copy already achieves so well. #10 is
last in this batch because it is the only one requiring a decision rather than an edit.

**Then, in order:** P0-06, P0-08, P0-12, P0-13, P0-14, P0-16, P0-17, P0-18 → P1-01 → P1-02.

---

# DO NOT TOUCH YET

Unchanged until the named dependency completes. Each is either verified-correct, load-bearing,
or both — churn here spends credibility without buying anything.

| System | Why | Unblocked by |
|---|---|---|
| **`packages/db/src/scoped.ts`** | The tenancy invariant, empirically verified fail-closed. The GUC-as-parameter choice closes a real injection sink | P1-17 (instrumentation only — **never** change the scoping mechanism) |
| **RLS migrations and policies** | 14 tables under FORCE RLS, independently reproduced. The phase-1/phase-2 split is subtle and correct | P1-09, additively only |
| **`server/http/route.ts` boundary ordering** | "THE ORDER IS THE CONTRACT" is literally true — reordering breaks the A7 property | Never. Extend, do not reorder |
| **`server/auth/{jwt,context,policy,session,pkce}.ts`** | ~120 tests. Asymmetric-only, algorithms pinned in code, enumeration-safe. **Do not refactor for style** | P1-03 (context consumers only) |
| **`middleware.ts` + `public-routes.ts`** | Deny-by-default, 82 tests. Adding a public path is a security decision | P3-06 (one deliberate webhook entry) |
| **The refresh loop guard** | The structural guard is the cleverest thing in the codebase. Changing failure handling must preserve it | P1-07 — design *against* the guard, not around it |
| **`packages/contracts`** | Canonical hashing with test vectors, problem+json, edge/node split | P1-04 (additive view models) |
| **`packages/db/src/audit.ts`** | The extension/transaction split is a correct workaround for a real Prisma limitation | Never, absent a Prisma upgrade |
| **Prisma schema shape** | Integer cents, provenance, household-prefixed indexes, sane cascades. **Add indexes; do not reshape** | P1-12 (indexes), P3-07 (new tables) |
| **`lib/domain/queries.ts` signatures** | The cutover seam and the repo's best structural asset. Bodies change; signatures must not | P1-18 (bodies only) |
| **`lib/api-client.ts`** | Single HTTP door, typed errors, CSRF in one place | P1-05 (add the server half of idempotency) |
| **Design tokens + `ui/` primitives** | Token discipline is why the UI is consistent | Phase 2, additively |
| **`entitlements` schema** | Columns are well designed. Do not add enforcement before a metering source exists | P3-04 |
| **CI guardrails** | Encode governance mechanically | P1-15 (add only; remove nothing) |
| **Governing documents** | `FOUNDING_PRINCIPLES`, PRD, ADRs — each has its own amendment process | PRD §21 for scope; ADR for constraint. **Exception:** P0-18's factual corrections |
| **Anything Plaid** | Constitutionally sequenced, not forbidden — but gated three ways | P4-00 |

---

# READY TO IMPLEMENT WHEN

Concrete conditions confirming the audit phase is complete and implementation may begin.

**Audit completeness — all satisfied:**
- [x] Ground truth established with executed verification (459 tests, RLS reproduced independently)
- [x] UX/UI audited — 14 P0, 10 P1, 10 P2, with a design-system checklist
- [x] Functional interaction matrix — 31 Broken / 9 Suspicious / 18 Verified, evidence-typed
- [x] Architecture reviewed — strengths, debt, and a 13-item do-not-rewrite list
- [x] Security audited — 6 P0, 8 P1, 8 P2, plus a five-gate hardening gate
- [x] Subscription/entitlement/Plaid separated, with 10 open product decisions recorded
- [x] This blueprint, with every task carrying dependencies, risk, tests, and a model

**Before the first commit of Phase 0:**
- [ ] Blueprint reviewed and DO-FIRST order accepted (or amended, in writing)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` green on the branch
  (**verified green as of this audit**: 459 passing)
- [ ] A working database for integration tests (`DATABASE_URL` as `app_user`, `DATABASE_ADMIN_URL`
  as owner) — a suite passing on the admin connection proves nothing

**Before Phase 1 begins:**
- [ ] All Phase 0 tasks merged and verified
- [ ] E2E harness exists, even with one test (P1-14 skeleton)
- [ ] A deployment target exists (P1-01) — P1-17 cannot be measured without it

**Before Phase 3 begins:**
- [ ] **G1 has returned a verdict.** Pricing (OD-2) and the wedge are confirmed or re-rolled
- [ ] OD-2, OD-3, OD-4, OD-5, OD-8, OD-9, OD-10 answered
- [ ] Identity lifecycle (P1-02) shipped — an entitlement row needs a household to belong to
- [ ] Outbox dispatcher (P1-13) shipped — webhook projection has nowhere to run without it

**Before Phase 4 is even scoped:**
- [ ] PRD §21 amendment passed (OD-6)
- [ ] **ADR-011 authored** — the PRD names it; it does not exist
- [ ] ADR-007 (field-level encryption) implemented — a Plaid `access_token` must not be the
  first thing that needs it
- [ ] Plaid added to the public subprocessor list with the 30-day notice served

---

## Closing

Two disciplines matter more than the task order.

**First: most of Phase 0 is deletion.** The instinct on receiving a 60-task queue is to start
building. The highest-value work here is removing claims the product cannot support. That is
cheap, reversible, and it changes the product's character from misleading to candidly
incomplete — which is what the onboarding copy already gets right, and what the rest should
match.

**Second: the do-not-touch list is load-bearing.** This codebase's foundation is genuinely
better than its stage requires, and the strongest code in it — the scoped client, the boundary
ordering, the refresh loop guard — is also the easiest to break while "improving." Preserve it,
extend it, and spend the effort on the middle of the system that is actually missing.
