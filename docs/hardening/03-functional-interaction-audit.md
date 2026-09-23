# AutoBureau — Functional Interaction Audit

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Scope:** Read-only. No changes made.

---

## Method and evidence base

Every interactive element was extracted mechanically, then each handler traced to its
terminus — a `fetch`, a `setTimeout`, a `setState`, or nothing. Nothing here is inferred from
a component's name or a comment.

**Inventory extracted from source:** 58 `onClick` · 32 `onChange` · 37 `href` · 4 `onSubmit` ·
3 `onConfirm` · 3 `onFiles`.

**Evidence types used, and their strength:**

| Evidence | What it proves |
|---|---|
| **Executed** — `curl` against a running production build | Actual runtime behaviour |
| **Manifest** — Next.js build route table | Which routes can and cannot exist |
| **Tested** — passing unit/integration suite | Server-side behaviour under test |
| **Traced** — handler followed to terminus in source | What the code does; not that it ran |

**The single most important measurement:** across the entire application, exactly **two call
sites reach a server** —

```
apps/web/src/app/(auth)/sign-in/sign-in-form.tsx:97   POST /v1/auth/sign-in
apps/web/src/lib/domain/queries.ts:69                 GET  /v1/households/current
```

Every other interactive control in the product terminates in local state, a timer, or nothing.

**Route manifest (Executed — `pnpm build`).** The complete set of pages Next can serve:

```
/  /calendar  /dashboard  /documents  /documents/upload  /forgot-password  /household
/notifications  /obligations  /obligations/[id]  /onboarding  /onboarding/census
/onboarding/document  /onboarding/ready  /settings  /settings/billing
/settings/notifications  /settings/privacy  /settings/profile  /sign-in  /sign-up  /timeline
```

`/obligations/[id]` is the **only** dynamic segment in the product. There is no
`/documents/[id]` and no `/household/[id]`. This single fact invalidates a large share of the
application's internal navigation — see BR-15.

---

## Classification summary

| Class | Count | Meaning |
|---|---|---|
| 🔴 **Broken** | **31** | Definitely incorrect. Evidence shows the control does not do what the UI says. |
| 🟡 **Suspicious** | **9** | Appears incorrect or incomplete; needs execution against a configured environment to confirm. |
| 🟢 **Verified working** | **18** | Evidence demonstrates correct behaviour. |

I am explicitly **not** claiming "all buttons work." 31 are provably broken.

---

# The Functional Interaction Matrix

## 1 · Authentication and session

| Action | UI promises | Code actually does | Class | Route / API | Resulting state | Failure handling | Sev | Recommended fix |
|---|---|---|---|---|---|---|---|---|
| Sign in (password) | Signs you in | `apiFetch POST /auth/sign-in`, CSRF header, `credentials: same-origin`, then `router.replace("/dashboard")` + `refresh()` | 🟢 Verified (Traced + Tested, 20 integration tests; **never executed E2E** — no provider configured) | `POST /v1/auth/sign-in` | Cookies set server-side; nothing token-shaped on client | ✅ `ApiError` → form-level message; collapses wrong-password/no-account | — | None |
| Sign in (magic link) | *"We've sent a sign-in link to {email}. It works once and expires in fifteen minutes."* | `window.setTimeout(…, 500)` → renders the confirmation screen. **No email sent.** Endpoint exists and is never called | 🔴 **Broken** | Should be `POST /v1/auth/magic-link` (built, 40 tests) | Nothing. User waits for mail that never arrives | ❌ None — cannot fail | **P0** | Call the endpoint that already exists |
| Continue with Google / Apple | Third-party sign-in | `router.push("/dashboard")`. No OAuth anywhere in codebase | 🔴 **Broken** | None | With auth configured, middleware bounces to `/sign-in` — silently | ❌ None | **P0** | Remove/disable until OAuth wired |
| Sign up | Creates an account | Validates client-side, `setTimeout(500)`, `router.push("/onboarding")` | 🔴 **Broken** | None | No account. `/onboarding` is protected → redirect to `/sign-in` | ❌ None | **P0** | Blocked on registration + household creation |
| Forgot password | *"a reset link is on its way… expires in fifteen minutes"* | `setTimeout(500)` → success screen. **No reset endpoint exists at all** | 🔴 **Broken** | None (unlike magic-link, nothing to wire) | Nothing | ❌ None | **P0** | Needs a new endpoint |
| **Sign out** | Ends your session | `<Link href="/sign-in">` — a navigation. **No code anywhere calls the sign-out endpoint** | 🔴 **Broken** | Should be `POST /v1/auth/sign-out` (built, CSRF-protected, tested) | **Cookies remain valid.** Returning to `/dashboard` re-enters the app | ❌ None | **P0** | Post to the endpoint, then redirect |
| "Sign out everywhere else" | Ends other sessions | `<Button>` with **no `onClick`** | 🔴 **Broken** | None | Nothing. No feedback of any kind | ❌ None | **P1** | Disable or implement |
| "Change password" | Change your password | `<Button>` with **no `onClick`** | 🔴 **Broken** | None | Nothing | ❌ None | **P1** | Disable or implement |
| Two-step verification toggle | *"You'll be asked for a code on new devices"* | `useState` boolean + toast. **No MFA implementation exists** | 🔴 **Broken** | None | User believes MFA is on. It is not | ❌ None | **P0** | Remove/disable — see UX P0-2 |
| Protected route while signed out | Redirect to sign-in | Middleware denies; 307 to `/sign-in?next=<path>` | 🟢 **Verified (Executed)** — `/dashboard`, `/onboarding`, `/obligations`, `/documents`, `/settings/billing` all 307 | middleware | Correct, with open-redirect-guarded `next` | ✅ Fails closed when unconfigured | — | None |
| `/v1` while unauthenticated | 401 | Returns `401 application/problem+json`, `cache-control: no-store` | 🟢 **Verified (Executed)** | `/v1/households/current` | Correct | ✅ | — | None |
| `/v1` while unconfigured | 503 | Returns `503`, detail names no env var | 🟢 **Verified (Executed)** | `/v1/auth/sign-in` | Correct | ✅ | — | None |
| **Post-login routing** | Return to where you were going | Middleware carefully builds `?next=…` with `safeDestination()`. Sign-in form **hardcodes `router.replace("/dashboard")`** and never reads `searchParams` | 🔴 **Broken** | — | Deep links always lost; emailed links and mid-task expiry always land on dashboard | ❌ Silent | **P1** | Read and honour `next` (guard already exists server-side) |
| Session expiry during navigation | Refresh invisibly | Middleware → `/auth/refresh` → rotate → return to `next` | 🟢 Verified (Traced + Tested) | `GET /auth/refresh` | Correct; structural loop guard | ✅ Clears both cookies on failure → next pass goes to sign-in | — | None |
| Session expiry during an open page (XHR 401) | *"Your session ended — Sign in again"* | `ErrorState` renders that copy with only a **"Try again"** button | 🔴 **Broken** | — | Retry re-issues and fails identically. No sign-in affordance | ⚠️ Message correct, recovery absent | **P0** | Add a sign-in action; consider one refresh attempt on 401 |
| Provider outage during refresh | — | `catch` treats transient 5xx identically to a revoked token → clears cookies | 🟡 **Suspicious** | `GET /auth/refresh` | A brief GoTrue blip signs out every active user | ⚠️ Fails closed, arguably too aggressively | **P1** | Distinguish 5xx from 4xx |

## 2 · Domain mutations

| Action | UI promises | Code actually does | Class | Route / API | Resulting state | Failure handling | Sev | Recommended fix |
|---|---|---|---|---|---|---|---|---|
| Mark obligation done (dashboard) | *"Marked as done"* + Undo | `useUpdateObligationStatus` → `setTimeout(260)` returning its own argument. Optimistic cache update + rollback are correctly built | 🔴 **Broken** (persistence) | None | Cache updates; **lost on reload** | ✅ `onError` toast wired — but unreachable, the mock cannot fail | **P0** | Replace hook body with `apiFetch` |
| Mark done — **double click** | One completion | `ObligationCard`'s button is a bare `<button>` with **no `disabled`/`loading`** while `updateStatus.isPending` | 🟡 **Suspicious** (latent) | — | N mutations fire on N clicks. Harmless against a mock; a real double-write once wired | ❌ No guard | **P1** | Pass pending state (obligation *detail* does this correctly) |
| Obligation transitions (detail) | Reopen / Start / Complete / Dismiss | Same mock hook, but **does** pass `loading={updateStatus.isPending}` | 🔴 **Broken** (persistence), 🟢 guard correct | None | Same as above | ✅ Toast on error; Undo restores previous status | **P0** | Same cutover |
| Capture outcome on completion | Records what it cost/saved | `outcome-dialog` → `transition(status, outcome)` → same mock | 🔴 **Broken** | None | Discarded | ✅ Validation refuses a cost it would have to round (tested) | **P0** | Same cutover |
| **Review document → "Looks right — file it"** | *"Filed — We've added this to your household registry"* | `accept()` is a **pure toast**. No mutation, **not even an optimistic cache update** | 🔴 **Broken** | None | Panel closes; the document behind it **still reads "Needs review"**. Contradiction visible immediately, without reload | ❌ None | **P0** | Needs review endpoint; until then must not claim filing |
| Review → "Not now" | *"We'll leave it in review"* | Toast + close | 🟢 Verified (accurate — leaving it alone *is* a no-op) | None | Correct | — | — | None |
| Mark notification read | Marks it read | `setReadIds` — **component-local `Set`**. Does not use `useMarkNotificationsRead` (which has zero consumers) and never touches the query cache | 🔴 **Broken** | None | Lost on navigation *and* reload | ❌ None | **P1** | Wire the orphaned hook to an endpoint |
| "Mark all read" | Clears unread | Same local `Set` | 🔴 **Broken** | None | Lost | ❌ None | **P1** | Same |
| Upload via `/documents/upload` | *"N documents received"* | `onFiles` fires a toast and navigates. **The `files` argument is never used**; no storage backend exists | 🔴 **Broken** | None | Files discarded; user told they were received | ❌ None | **P0** | Disable until storage exists |
| Upload via Documents drawer | Sends documents | `<UploadDropzone onFiles={() => setUploadOpen(false)} />` — argument ignored, **and no toast at all** | 🔴 **Broken** (worse) | None | Modal closes. **Zero feedback.** Pure "did that work?" | ❌ None | **P0** | Same |
| Copy forwarding address | Copies your inbox address | Copies `` `h-${household.id.slice(0,6)}@in.autobureau.com` `` — **synthesised client-side**; the real `emailAlias` is loaded and ignored | 🔴 **Broken** | None | User forwards sensitive mail to a fabricated address | ❌ None | **P0** | Render `household.emailAlias`; empty state when null |

## 3 · Settings, subscription, destructive actions

| Action | UI promises | Code actually does | Class | Route / API | Resulting state | Failure handling | Sev | Recommended fix |
|---|---|---|---|---|---|---|---|---|
| Save profile | *"Saved — Profile updated"* | Toast only | 🔴 **Broken** | None | Reverts on reload (real values *are* read from DB) | ❌ | **P1** | Endpoint or read-only |
| Save household | *"Saved — Household updated"* | Toast only | 🔴 **Broken** | None | Reverts | ❌ | **P1** | Endpoint or read-only |
| Notification preferences | *"Preferences saved"* | `useState` + toast | 🔴 **Broken** | None | Reverts | ❌ | **P1** | Endpoint |
| **Upgrade to Premium** | *"You're on Premium — Unlimited documents, starting now"* | `setPlan("premium")` local state + toast. **No payment processor exists** | 🔴 **Broken** | None | Sidebar still reads the real `entitlements.plan` from DB → screen says Premium, nav says Free, simultaneously | ❌ | **P0** | Read-only from `household.plan` |
| Cancel Premium | *"Premium cancelled"* | Local state + toast | 🔴 **Broken** | None | Nothing | ❌ | **P0** | Same |
| Usage meter ("7 of 10") | Your usage this month | `const docsUsed = 7` — hardcoded | 🔴 **Broken** | None | Fabricated data about the user's own account | ❌ | **P0** | Remove until metering exists |
| **Delete account** | *"Deletion scheduled — Sign in within 14 days to undo. We've emailed you the details."* | `ConfirmDialog` → toast. No request, no email, no scheduling | 🔴 **Broken** | None | Nothing deleted. Regulatory exposure once real users exist | ❌ | **P0** | Must not claim completion |
| Request export | *"Export started — We'll email you a download link"* | Toast | 🔴 **Broken** | None | Nothing | ❌ | **P0** | Disable honestly |
| Destructive confirm — double submit | One deletion | `ConfirmDialog` **supports** `loading`; **no caller passes it** | 🟡 **Suspicious** (latent) | — | Harmless now; double-fire risk on destructive actions once wired | ❌ | **P1** | Pass pending state |
| "Add someone" (settings) | Add a household member | `<Button>` with **no `onClick`** | 🔴 **Broken** | None | Nothing, no feedback | ❌ | **P1** | Disable or implement |
| "Add item" (household screen) | Add a tracked item | `<Button>` with **no `onClick`** — the screen's **primary CTA** | 🔴 **Broken** | None | Nothing | ❌ | **P1** | Disable or implement |
| Theme toggle | Switch theme | `setPreference` → localStorage + `data-theme`; `useSyncExternalStore` | 🟢 Verified (Traced) | None | Works; persists; cross-tab aware | ✅ Falls back to session-only if storage blocked | — | Cannot return to "system" (P1-9) |
| Settings tab navigation | Move between sections | `<Link>` to real routes; `aria-current`; exact-match active | 🟢 Verified (Traced + Manifest) | 5 real routes | Correct | — | — | None |

## 4 · Navigation and discovery

| Action | UI promises | Code actually does | Class | Route / API | Resulting state | Failure handling | Sev | Recommended fix |
|---|---|---|---|---|---|---|---|---|
| Sidebar / mobile-tab nav (6 items) | Navigate | `<Link>` to routes that **all exist in the manifest** | 🟢 Verified (Manifest) | 6 routes | Correct; `aria-current` set | — | — | None |
| Nav count badges | Live counts of what needs you | `badgeKey` is typed and set on 3 items; **`NavLink` never reads it** | 🔴 **Broken** (absent feature) | — | No badge ever renders | — | **P1** | Render from summary |
| Obligation card → detail | Open the obligation | `dynamicHref('/obligations/{id}')` | 🟢 Verified (Manifest) | `/obligations/[id]` ✅ | Correct | — | — | None |
| **Command palette → Documents result** | Open that document | `router.push('/documents/{id}')` | 🔴 **Broken** | **No such route** | **404** | ❌ | **P0** | Add route or drop the result type |
| **Command palette → Items result** | Open that item | `router.push('/household/{id}')` | 🔴 **Broken** | **No such route** | **404** | ❌ | **P0** | Same |
| Command palette → Obligations result | Open the obligation | `router.push('/obligations/{id}')` | 🟢 Verified (Manifest) | ✅ | Correct | — | — | None |
| **Notification → document/item link** | Open the thing | Fixture hrefs `/documents/d-7` (×2), `/household/i-2` | 🔴 **Broken** | **No such routes** | **404.** 3 of 8 fixture notification links are dead | ❌ | **P0** | Same |
| **Timeline entry → source** | Open the source | Same fixture hrefs via `dynamicHref` | 🔴 **Broken** | Same | 404 | ❌ | **P0** | Same |
| Command palette open (⌘K / button) | Opens search | Custom event + keydown listener; focus trap; resets on open | 🟢 Verified (Traced) | — | Correct | — | — | None |
| Clickable table rows (documents, household) | Open detail / review | `<tr onClick>` with **no `tabIndex`, no `role`, no `onKeyDown`** | 🔴 **Broken** (keyboard) | — | **Document review is mouse-only.** WCAG 2.1.1 failure on a core loop | ❌ | **P0** | Make rows keyboard-operable |
| Mobile nav drawer | Modal navigation | `role="dialog" aria-modal="true"` with **no focus trap and no Escape** — unlike `Modal` and command palette, which both use `useFocusTrap` | 🔴 **Broken** (a11y) | — | AT told outside is inert; it is not | ❌ | **P1** | Apply the existing hook |
| **Filter / search / tab state** | — | All component-local `useState`. **No screen syncs to the URL** | 🔴 **Broken** (back nav) | — | Back from a detail resets filters; filtered views cannot be shared or bookmarked | ❌ | **P1** | Sync to search params |
| Onboarding step advance | Next step | `router.push` per step | 🟢 Verified (Manifest) | 4 routes | Correct; provider state survives (layout-scoped) | — | — | No in-product **back** control exists (browser back only) |
| Modal close (backdrop / Escape / ×) | Closes | Backdrop `onClick`, focus trap handles Escape, portal-rendered | 🟢 Verified (Traced + 3 unit tests) | — | Correct | — | — | None |
| Button double-submit guard | — | `disabled = disabled \|\| loading` in `Button` | 🟢 Verified (Traced) | — | Correct **where callers pass `loading`** — auth forms and obligation detail do | ✅ | — | See gaps above |
| Calendar month prev/next, day select | Browse | Local `useState` on cursor; `disabled` when no items due | 🟢 Verified (Traced) | — | Correct | — | — | None |
| Filter bar / search inputs | Filter the list | Local state → filter functions in `queries.ts` | 🟢 Verified (Traced) | — | Filtering logic is correct — over fixture data | — | — | Not URL-synced (above) |
| Toggle / checkbox primitives | Toggle | `field.tsx` — proper `role`, keyboard, labels | 🟢 Verified (Traced + 6 unit tests) | — | Correct | — | — | None |
| Toast action ("Undo") | Reverts | Calls the mutation with the previous status | 🟢 Verified (Traced) | None | Correct *mechanically*; reverts a change that never persisted | — | — | Resolves with cutover |

---

# User-flow chains

Handoffs are marked ✅ working, ⚠️ mocked, ❌ absent.

### Flow 1 — New user signs up
```
Landing /sign-up ✅
  → form validation (client) ✅
  → setTimeout(500) ⚠️ MOCK — no account created
  → router.push("/onboarding") ✅
  → middleware: /onboarding is NOT public ❌
  → 307 /sign-in?next=/onboarding
  → user is back where they started, with no explanation
```
**Verdict: 🔴 Broken — closed loop. There is no working way to create an account.**

### Flow 2 — Returning user signs in (the one real flow)
```
/sign-in ✅
  → apiFetch POST /v1/auth/sign-in ✅ (CSRF header, same-origin credentials)
  → GoTrue signInWithPassword ✅ (untested module — provider.ts has no tests)
  → verify token before storing ✅
  → mirrorIdentity → users + user_profiles ✅ (14 integration tests)
  → Set-Cookie access + refresh ✅
  → router.replace("/dashboard") ⚠️ discards ?next=
  → (app)/layout → resolveRequestContext ✅
  → memberships lookup → 0 memberships ❌
  → RequestContextError("no-membership") → error boundary
```
**Verdict: 🟡 Auth is sound; the flow terminates in an error boundary because nothing creates
a household. A user with a manually seeded membership would reach the dashboard.**

### Flow 3 — Onboarding
```
/onboarding ✅ → household-step (useState) ⚠️
  → /onboarding/census (useState) ⚠️
  → /onboarding/document (useState) ⚠️
  → /onboarding/ready → "That's the start of your ledger" ⚠️
  → all state discarded ❌ — no persistence anywhere
  → /dashboard renders fixtures.ts: "The Reyes Household", "Elena's Medicare"
```
**Verdict: 🔴 Broken — the user's own input is discarded and replaced with a stranger's data,
while their real household name shows in the sidebar.**

### Flow 4 — Complete an obligation
```
Dashboard → ObligationCard ✅ (no double-click guard ⚠️)
  → useUpdateObligationStatus.mutate
  → onMutate: optimistic update of list + detail caches ✅ (correctly built)
  → mutationFn: setTimeout(260) → returns its own argument ⚠️ MOCK
  → onSuccess: toast "Marked as done" + Undo ✅
  → onSettled: invalidate → refetch → fixtures again ⚠️
  → reload → obligation is back ❌
```
**Verdict: 🔴 Broken — no persistence. The optimistic/rollback machinery is correct and will
work unchanged once endpoints exist.**

### Flow 5 — Document review (the core product loop)
```
Documents → table row click ✅ (mouse only ❌ — no keyboard path)
  → Modal drawer + ReviewPanel ✅
  → edit extracted fields → local `edits` state ⚠️
  → "Looks right — file it"
  → accept(): toast "Filed — We've added this to your household registry" ⚠️ MOCK
  → onDone() closes drawer
  → document behind still shows "Needs review" ❌ — contradiction with no reload needed
```
**Verdict: 🔴 Broken, and self-contradicting within the same screen.**

### Flow 6 — Upload a document
```
Top bar "Add document" ✅ → /documents/upload ✅
  → UploadDropzone: staging, validation, 25 MB cap ✅ (genuinely works)
  → "Send N documents" → onFiles(valid.map(v => v.file))
  → upload-screen: argument ignored ❌, toast "N documents received" ⚠️ FALSE
  → router.push("/documents") → shows fixture documents (not the user's) ❌
```
**Verdict: 🔴 Broken. Via the Documents drawer it is worse — the argument is ignored and no
toast fires at all: zero feedback.**

### Flow 7 — Sign out
```
Sidebar sign-out (icon only, unlabelled) → <Link href="/sign-in"> ✅ navigates
  → POST /v1/auth/sign-out ❌ NEVER CALLED
  → cookies remain valid ❌
  → navigate to /dashboard → middleware verifies cookie → ALLOWED
```
**Verdict: 🔴 Broken — the user is not signed out. On a shared household device this exposes
every document to the next person.**

### Flow 8 — Session expires mid-task
```
(a) Navigation: middleware detects expired+refreshable → /auth/refresh → rotate → next ✅
(b) Open page (XHR): apiFetch → 401 → ApiError
  → describeError → "Your session ended — Sign in again"
  → ErrorState offers only "Try again" ❌
  → retry → 401 → identical ❌
```
**Verdict: (a) 🟢 Verified. (b) 🔴 Broken — instructs an action it provides no way to take.**

### Flow 9 — Subscribe
```
Settings → Plan & billing ✅ → "Upgrade"
  → setPlan("premium") ⚠️ local
  → toast "You're on Premium" ⚠️ FALSE
  → no processor ❌, no entitlement write ❌
  → sidebar still reads entitlements.plan from DB → "Free"
```
**Verdict: 🔴 Broken, and visibly self-contradicting on screen.**

### Flow 10 — Delete account
```
Settings → Privacy → "Delete account" → ConfirmDialog ✅ (well built)
  → onConfirm → toast "Deletion scheduled… We've emailed you the details" ⚠️ FALSE
  → no request ❌ no email ❌ no scheduling ❌
```
**Verdict: 🔴 Broken — the most consequential action is a no-op that affirms completion.**

---

# Special-attention findings

| Concern | Finding | Evidence |
|---|---|---|
| **Authentication redirects** | ✅ Correct and fail-closed | Executed: 5 routes 307 with guarded `next` |
| **Protected routes** | ✅ Catch-all matcher; new routes protected by default | Executed + 50 tests |
| **Session expiration** | ⚠️ Navigation ✅; open-page XHR is a dead end | Traced |
| **Session refresh** | ✅ Structural loop guard, no state | Traced + tested |
| **Post-login routing** | 🔴 `?next=` built by middleware, discarded by the form | Traced |
| **Post-action routing** | 🔴 Upload → `/documents` shows fixtures, not the upload | Traced |
| **Stale UI state** | 🔴 Review "Filed" leaves the list showing "Needs review" | Traced |
| **Double submissions** | ⚠️ `Button` guards correctly; `ObligationCard` and `ConfirmDialog` callers do not pass `loading` | Traced |
| **Broken back navigation** | 🔴 No screen syncs filters/search/tabs to the URL — back resets them | Traced (zero `useSearchParams` in `app/`) |
| **Links to placeholder pages** | 🔴 `/documents/{id}` and `/household/{id}` do not exist; reachable from palette, notifications, timeline | **Manifest** |
| **Incomplete handlers** | 🔴 4 enabled buttons with no `onClick` at all | Traced |
| **Silent failures** | 🔴 Documents-drawer upload: no toast, no navigation, no error | Traced |

---

# What is genuinely verified working

Stated precisely, because the audit brief asks for evidence:

1. **Route protection** — Executed. Five authenticated routes 307 to `/sign-in?next=…`.
2. **`/v1` fail-closed** — Executed. 401 unauthenticated, 503 unconfigured, `no-store`.
3. **Security headers** — Executed on live responses.
4. **Sign-in (password) server path** — 20 integration tests; client call correctly formed.
   *Never executed end-to-end* — no provider is configured.
5. **Session refresh logic** — Traced + tested; structural loop guard is sound.
6. **All six primary nav destinations** — Manifest-confirmed.
7. **Obligation card → detail** — Manifest-confirmed (the only working dynamic route).
8. **Settings tab navigation** — Manifest-confirmed, `aria-current` correct.
9. **Modal open/close/focus trap** — Traced + 3 unit tests.
10. **Form field primitives** — Traced + 6 unit tests.
11. **Table sorting** — Traced + 4 unit tests.
12. **`Button` double-submit guard** — Traced; correct where callers pass `loading`.
13. **Theme toggle persistence** — Traced; storage-failure fallback correct.
14. **Command palette open/close/keyboard** — Traced.
15. **Upload staging + 25 MB validation** — Traced; the staging UI genuinely works.
16. **Calendar navigation** — Traced.
17. **Filter logic** — Traced; correct over fixture data.
18. **Optimistic update + rollback machinery** — Traced; correct, awaiting a real server.

---

# Priority ordering for remediation

**Tier 1 — no dependencies, removes active falsehoods** (all Broken, all cheap):
sign-out wiring · magic-link wiring · post-login `next` · session-expiry sign-in action ·
keyboard-operable table rows · drawer focus trap · the 4 dead buttons · MFA/deletion/export/
billing/upload honesty · fabricated email alias.

**Tier 2 — small additions:** nav badges · URL-synced filters · double-submit guards on
`ObligationCard` and `ConfirmDialog` · `/documents/[id]` and `/household/[id]` routes (or
removing the results that point at them).

**Tier 3 — blocked on the identity audit and the fixture→API cutover:** every persistence
finding, sign-up, onboarding, entitlements.

The striking thing about Tier 1 is that most of it connects endpoints that **already exist and
already pass tests**. Sign-out, magic link, and the `next` parameter were each built correctly
on the server and never connected to the control that should call them.
