# AutoBureau — UX/UI Findings Report

**Date:** 2026-08-18
**Branch:** `claude/autobureau-hardening-audit-1tb0gh`
**Scope:** Read-only. No changes made.
**Basis:** `docs/hardening/01-current-state-ground-truth.md` — every claim traced to source.

---

## Method

Every screen, component, and state was read in source. Where behaviour was ambiguous I traced
the handler to its terminus (a `fetch`, a `setTimeout`, or nothing). Routing behaviour was
verified against a running build. Nothing here is inferred from file names.

**Surfaces reviewed:** landing · sign-up · sign-in · magic-link · OAuth · forgot-password ·
onboarding (4 steps) · dashboard · obligations (list + detail + outcome) · documents · upload ·
household · calendar · timeline · notifications · settings (household, profile, notifications,
privacy, billing) · command palette · nav/shell/top-bar · error, empty, loading, 404, and
destructive-action states.

---

## Overall assessment

**The craft is high. The integrity is not.**

This is, visually and structurally, a better-designed product than most funded consumer
startups ship. The design system is disciplined: one token layer, no hardcoded hex values, a
serif/sans pairing that genuinely reads as "calm authority," semantic colour kept deliberately
separate from brand, tabular numerals on every numeric column, `text-wrap: balance` on
headings. Accessibility is not an afterthought — `:focus-visible` only, a skip link, three
landmarks, focus reset on route change, reduced-motion handled by collapsing rather than
shortening. The empty states are the best thing in the repository: "Nothing needs you right
now" treats silence as the product's deliverable rather than as a blank screen, which is
exactly right for this category.

The copy is unusually good. The 404 is framed as a wrong turn. The error boundary says "Your
household data is safe." The onboarding hand-off explicitly refuses to declare victory:
*"what exists is a list of claims and a document being read."* Someone thought hard about the
difference between a system of record and a to-do list.

**And almost none of it does anything.**

The audit's central finding is not a design problem. It is that **the interface makes
present-tense factual assertions about actions that never occurred** — and it makes them
precisely where the product is asking for the most trust. Sign-out does not sign you out. The
two-factor toggle protects nothing. Account deletion deletes nothing and says "Deletion
scheduled." Data export exports nothing and says "We'll email you a download link." The
magic-link screen says "We've sent a sign-in link to [your address]. It works once and expires
in fifteen minutes" — a specific, confident, false claim.

For a product whose differentiator is *"we are the trustworthy one"*, this is not a polish
gap. A user who tests AutoBureau the way a careful person tests anything holding their
passport — turn on 2FA, sign out, check it held; request deletion, verify it happened — will
find that it lied every time. That discovery is unrecoverable.

**The good news is that this is a wiring problem, not a design problem.** The endpoints for
sign-out and magic-link are built, tested, and merely unreferenced. The correct fix for most
P0 findings is to connect a control or to stop claiming success — not to redesign anything.
Do not confuse the volume of P0 items with a need to rebuild: the design is the asset here.

---

# P0 — Trust-breaking or flow-breaking

## P0-1 · Sign out does not sign the user out

- **Location:** `components/layout/nav.tsx:153–163` (`SignOutButton`)
- **Current behavior:** Renders `<Link href="/sign-in">`. A client-side navigation. Verified:
  no code anywhere in the application calls `POST /v1/auth/sign-out`, though that endpoint is
  fully built, CSRF-protected, and tested.
- **Problem:** Session cookies remain valid. Navigating back to `/dashboard` re-enters the
  authenticated app. The user is shown the sign-in page while still signed in.
- **Why it matters:** This is a *household* product explicitly designed around shared
  responsibility — the same demographic shares tablets and family computers. A person who
  signs out on a shared device and walks away has left their passport, insurance policies, and
  medical accounts open to the next user. The in-code comment concedes the gap ("Killing the
  refresh token is the server's half of this... and arrives with the session wiring") — the
  wiring arrived; the button was never reconnected.
- **Proposed improvement:** Convert to a `<button>` posting to `/v1/auth/sign-out` via
  `apiFetch`, then `router.replace("/sign-in")` + `router.refresh()`. Keep a visible text
  label, not icon-only. Confirm nothing on failure — clear cookies regardless, as the endpoint
  already does.
- **Dependencies:** None. The endpoint exists and is public by design so an expired token can
  still clear cookies.
- **Regression risk:** **Low.** Isolated component. Note the deliberate trade-off recorded in
  the current comment: a `<button>` loses middle-click/open-in-new-tab. That is the correct
  loss — sign-out is an action, not a navigation.

## P0-2 · The two-step verification toggle protects nothing

- **Location:** `app/(app)/settings/profile/profile-settings.tsx:~66–78`
- **Current behavior:** `useState` boolean. Toggling fires a toast: *"Two-step verification
  on — You'll be asked for a code on new devices."* No provider call. No enrollment. No
  secret. State resets on reload.
- **Problem:** The user is told an authentication control is active. It does not exist.
- **Why it matters:** This is the most dangerous single control in the product. Every other
  false success wastes time; this one causes a user to *lower their guard* about a credential
  guarding identity documents. A user who enables 2FA reasonably stops worrying about password
  reuse. There is no MFA implementation anywhere in the codebase.
- **Proposed improvement:** Remove the control until GoTrue MFA enrollment is wired. If it
  must remain visible for demonstration, render it disabled with an explicit "Coming soon"
  affordance. **A disabled control that tells the truth is infinitely better than an active
  one that lies.**
- **Dependencies:** Real fix requires GoTrue MFA enrollment/challenge endpoints (`provider.ts`
  has no MFA methods today).
- **Regression risk:** **None** for removal/disable.

## P0-3 · Account deletion deletes nothing and reports success

- **Location:** `app/(app)/settings/privacy/privacy-settings.tsx:~110–125`
- **Current behavior:** `ConfirmDialog` → `onConfirm` → toast *"Deletion scheduled — Sign in
  within 14 days to undo. We've emailed you the details."* No request. No email. No scheduling.
- **Problem:** The most consequential action in the product is a no-op that affirms completion.
- **Why it matters:** Three compounding harms. (1) The user believes their most sensitive data
  is being erased; it is not. (2) `FOUNDING_PRINCIPLES` names "deletion is a feature" as a
  first-class workflow and the screen's own copy leans on it — *"we say so plainly rather than
  pretending a backup can be surgically edited"* — honesty framing wrapped around a no-op.
  (3) Once real users exist, a deletion request acknowledged and not performed is a regulatory
  exposure under GDPR Art. 17 / CCPA, not merely a bug.
- **Proposed improvement:** Until the deletion cascade exists, the confirm action must not
  claim completion. Either disable the flow with an honest explanation, or have it open a
  support contact path. When built: soft-delete + scheduled cascade via the existing outbox,
  with a real confirmation email.
- **Dependencies:** Deletion cascade job (the `unsafeAcrossAllHouseholds` escape hatch is
  documented for exactly this), outbox dispatcher, email transport. None exist.
- **Regression risk:** **None** for making it honest.

## P0-4 · Data export exports nothing and reports success

- **Location:** `app/(app)/settings/privacy/privacy-settings.tsx:~78–90`
- **Current behavior:** Button → toast *"Export started — We'll email you a download link,
  usually within a few minutes."* Nothing happens.
- **Why it matters:** Same class as P0-3. Export is the user's escape hatch and a stated
  anti-lock-in promise; a silent failure means they discover it only when the email never
  arrives — at the moment they most need it.
- **Proposed improvement:** Disable with honest copy until implemented.
- **Dependencies:** Export job, storage, email transport.
- **Regression risk:** **None.**

## P0-5 · The magic-link screen claims an email was sent

- **Location:** `app/(auth)/sign-in/sign-in-form.tsx:~82–90`
- **Current behavior:** `window.setTimeout(…, 500)` then renders *"Check your email — We've
  sent a sign-in link to **{email}**. It works once and expires in fifteen minutes."* The
  in-code comment states the wiring is deliberately out of scope. `POST /v1/auth/magic-link`
  is built and tested and is never called.
- **Problem:** A precise factual claim, including a stated expiry, about an email that does
  not exist.
- **Why it matters:** The sign-in form's own comment identifies passwordless as *the wedge
  persona's primary path* — "someone who set this up in a hospital waiting room eight weeks
  ago and has no idea what password they chose." The path most likely to be used by the target
  user is the one that silently fails. The user waits, checks spam (as the copy instructs),
  and concludes the product is broken.
- **Proposed improvement:** Call `apiFetch("/auth/magic-link", …)`. The endpoint, PKCE verifier
  cookie, and `/auth/callback` redemption all exist and pass 40 tests.
- **Dependencies:** `AUTH_*` configuration. Endpoint is ready.
- **Regression risk:** **Low** — replacing a `setTimeout` with the call it was written for.

## P0-6 · OAuth buttons do not authenticate

- **Location:** `app/(auth)/oauth-options.tsx:~30–38`
- **Current behavior:** "Continue with Google" / "Continue with Apple" call
  `router.push(next)`. No OAuth. The component comment asserts "the buttons work."
- **Problem:** In a configured deployment the push lands on `/dashboard` or `/onboarding`
  without a session; middleware redirects to `/sign-in`. The user clicks a sign-in button and
  is returned to sign-in with no message.
- **Why it matters:** A silent bounce is the worst possible failure — no error, no explanation,
  nothing to retry. The user concludes sign-in is broken and leaves. There is no OAuth
  implementation anywhere.
- **Proposed improvement:** Remove or disable both buttons until the provider OAuth redirect is
  wired. They are the most prominent controls on both auth screens; leaving them non-functional
  is worse than not offering them.
- **Dependencies:** GoTrue OAuth authorize/callback flow.
- **Regression risk:** **None** for removal.

## P0-7 · Sign-up creates no account

- **Location:** `app/(auth)/sign-up/sign-up-form.tsx:42–57`
- **Current behavior:** Validates client-side, then `window.setTimeout(…, 500)` →
  `router.push("/onboarding")`.
- **Problem:** No account is created. `/onboarding` is not a public route, so with auth
  configured, middleware immediately redirects to `/sign-in`.
- **Why it matters:** The primary conversion path terminates in a redirect loop back to
  sign-in. Combined with P0-6, **there is no working way to create an account.**
- **Proposed improvement:** Wire to a real registration path. This is blocked by the deeper
  architectural gap — see P0-8.
- **Dependencies:** Registration endpoint + household creation (neither exists).
- **Regression risk:** **Medium** — touches the identity model; sequence behind the identity
  audit.

## P0-8 · Onboarding output is discarded; the dashboard then shows a stranger's household

- **Location:** `app/onboarding/*` (all four steps), `lib/domain/fixtures.ts`
- **Current behavior:** Onboarding state is pure React `useState` with explicitly no
  persistence. The user names the people they care for and declares what to track. On finish,
  all of it evaporates. The dashboard then renders `fixtures.ts` — a different fictional
  household ("The Reyes Household", viewer "Dana Reyes", "Elena's Medicare Part B enrollment
  window").
- **Problem:** The user enters *their mother's name*, completes a thoughtful census, and lands
  on a dashboard about people who do not exist.
- **Why it matters:** This is the single most damaging moment in the product for a live
  demonstration or a first real user. The `ReadyStep` copy makes it worse by being good — it
  promises *"That's the start of your ledger"* and lists "Deadlines we're hunting for," none of
  which appear anywhere afterwards. The household *name* in the sidebar comes from the database
  while the content comes from fixtures, so the two are visibly incoherent on the same screen.
- **Proposed improvement:** Onboarding must persist: create the household, membership, and
  declared members/items, then the dashboard must read them. Until then, the demo should seed a
  fixture household whose identity matches what onboarding collected, so the narrative at least
  holds.
- **Dependencies:** Household creation (P0 in ground truth), `/v1` write endpoints, the
  fixture→API cutover.
- **Regression risk:** **High** — this is the fixture→API cutover. Sequence behind the identity
  and functionality audits.

## P0-9 · Every domain mutation reports success and persists nothing

- **Location:** `lib/domain/queries.ts` (`useUpdateObligationStatus`,
  `useMarkNotificationsRead`); consumed by dashboard, obligations list, obligation detail
- **Current behavior:** `mutationFn` is `await new Promise(r => setTimeout(r, 260))` returning
  its own argument. The optimistic update, rollback, and toast (*"Marked as done"* with Undo)
  all work correctly against a cache that is never reconciled with a server.
- **Problem:** The user completes an obligation, sees confirmation, reloads, and it is back.
- **Why it matters:** In an obligations product, "did my action stick?" is *the* question. A
  user who marks a passport renewal done, and later finds it undone, cannot trust the ledger —
  which is the entire product. The optimistic-update machinery is well built and will work
  unchanged once endpoints exist; the problem is purely the absent server.
- **Proposed improvement:** Replace the twelve hook bodies with `apiFetch` calls. Signatures
  must not change — all 14 screens depend on them and nothing else, which is the repository's
  best structural asset.
- **Dependencies:** `/v1` domain endpoints (none exist beyond `households/current`).
- **Regression risk:** **High** — the cutover itself. Contain it to `queries.ts`.

## P0-10 · Document upload discards files and reports receipt

- **Location:** `app/(app)/documents/upload/upload-screen.tsx:~43–50`
- **Current behavior:** `UploadDropzone.onFiles` fires a toast — *"N documents received — We'll
  let you know if anything needs a second look"* — then navigates to `/documents`. The `files`
  argument is never used. No storage backend exists.
- **Problem:** Files are silently dropped while the UI affirms receipt.
- **Why it matters:** Document ingestion is the product's front door and the whole basis of the
  ledger. A user who photographs a renewal notice, sees "1 document received," and later finds
  nothing has been read has been told a direct falsehood about their own paperwork. The
  destination `/documents` then shows fixture documents, which will look to the user like
  *someone else's* files appearing after their upload.
- **Proposed improvement:** Until storage exists, the dropzone must not claim receipt. Disable
  with honest copy.
- **Dependencies:** Storage backend, upload endpoint, document pipeline — none exist.
- **Regression risk:** **None** for making it honest.

## P0-11 · The forwarding email address shown to users is fabricated

- **Location:** `app/(app)/documents/upload/upload-screen.tsx:25`
- **Current behavior:** `const alias = \`h-${household.id.slice(0, 6)}@in.autobureau.com\`` —
  synthesised client-side from the household UUID. The real `emailAlias` column is already
  loaded into the household provider and is ignored. A copy button copies the fabricated
  address.
- **Problem:** The user is given an address to forward sensitive mail to. It is not the
  system's address and no inbound mail infrastructure exists.
- **Why it matters:** The screen presents forwarding as *"the one that keeps working when
  you're busy — set it once and forget it."* A user who follows that advice forwards insurance
  and medical correspondence into a void — and may add the address to a mail rule, so the
  failure compounds silently over months. Copying an address to the clipboard makes it likely
  to be saved somewhere durable.
- **Proposed improvement:** Render `household.emailAlias` when present; when null, show an
  explicit "not yet available" state rather than a computed placeholder. Never synthesise an
  address that looks real.
- **Dependencies:** Alias provisioning; inbound email infrastructure.
- **Regression risk:** **Low** — the real value is already in the provider.

## P0-12 · Expired session is a dead end for anyone already on a page

- **Location:** `components/ui/error-state.tsx:63–70` (`describeError`), used by every screen
- **Current behavior:** A 401 from `apiFetch` renders *"Your session ended — Sign in again to
  pick up where you left off."* The only affordance `ErrorState` offers is **"Try again."**
  There is no sign-in link.
- **Problem:** The copy instructs the user to sign in again and provides no way to do so.
  "Try again" re-issues the same request and fails identically.
- **Why it matters:** Navigation-time expiry is handled well (middleware → `/auth/refresh` →
  back), but a token expiring while a page is open — the common case for a product people leave
  open — strands them in a retry loop. It also makes a working system look broken.
- **Proposed improvement:** Give `ErrorState` an optional primary action; for 401 render "Sign
  in" linking to `/sign-in?next=<current path>`. Better: have `apiFetch` treat 401 as a signal
  to route through `/auth/refresh` once before surfacing an error.
- **Dependencies:** None for the link. The refresh-on-401 variant should be designed with the
  security audit.
- **Regression risk:** **Low** for the action; **Medium** for automatic refresh (retry loops
  must be bounded).

## P0-13 · Users in more than one household are locked out entirely

- **Location:** `server/auth/context.ts:159–164`; `lib/api-client.ts:68`;
  `components/layout/nav.tsx:166` (`HouseholdSwitcher`)
- **Current behavior:** The server correctly refuses to guess between memberships: >1
  membership with no `X-Household-Id` → **400 `ambiguous-household`**. `apiFetch` accepts a
  `householdId` option that **no caller ever passes**. `HouseholdSwitcher` is a static display
  card that renders the name and member count and cannot switch.
- **Problem:** Any user belonging to two households gets 400 on every `/v1` call and an error
  boundary on every authenticated page.
- **Why it matters:** The PRD wedge is caregivers — the people most likely to hold their own
  household *and* a parent's. The persona the product is built for is the persona that breaks.
  The component named `HouseholdSwitcher` actively implies the capability exists.
- **Proposed improvement:** Implement real switching: persist the active household (cookie or
  route segment), pass it through `apiFetch`, and turn the switcher into a real control. The
  server contract already supports all of it.
- **Dependencies:** Product decision on how active household is represented; touches
  `RequestContext` consumers. Belongs to the identity audit.
- **Regression risk:** **Medium–High** — touches the universal chokepoint. Do not attempt
  before the identity audit.

## P0-14 · Billing implies a transaction that cannot occur

- **Location:** `app/(app)/settings/billing/billing-settings.tsx`
- **Current behavior:** "Upgrade" sets local state and toasts *"You're on Premium — Unlimited
  documents, starting now."* Cancel toasts *"Premium cancelled."* Usage shows a hardcoded
  `docsUsed = 7`. No payment processor exists anywhere in the codebase.
- **Problem:** The UI asserts a completed commercial transaction and an entitlement change.
- **Why it matters:** A user who believes they upgraded expects unlimited processing and may
  expect a charge; neither occurs. The hardcoded usage meter also displays fabricated data
  about the user's own account. The real `entitlements.plan` *is* read from the database into
  the provider — so the sidebar can show "Free" while this screen says "Premium," on the same
  screen, at the same time.
- **Proposed improvement:** Until a processor exists, render the current plan read-only from
  `household.plan` and replace the upgrade action with a waitlist or contact path. Remove the
  fabricated usage meter.
- **Dependencies:** Payment processor; entitlement enforcement; real usage metering.
- **Regression risk:** **Low** for making it read-only; sequence the rest behind the
  subscription audit.

---

# P1 — Significant polish and usability problems

## P1-1 · Dead controls that give no feedback at all

- **Location:** `profile-settings.tsx:79` ("Change password"), `:100` ("Sign out everywhere
  else"), `household-settings.tsx:124` ("Add someone")
- **Current behavior:** `<Button>` elements with no `onClick`. Clicking does nothing — no
  toast, no navigation, no disabled state.
- **Problem:** The user cannot tell whether the click registered, the app froze, or the feature
  is broken. This is the purest form of "did my action work?" friction.
- **Why it matters:** "Add someone" is the core household-management action; its absence blocks
  the product's stated organising principle. A silent no-op is worse than an error.
- **Proposed improvement:** Disable with a tooltip/hint, or implement. Never ship an enabled
  control with no handler.
- **Dependencies:** Member management endpoints for a real fix.
- **Regression risk:** **None** for disabling.

## P1-2 · Navigation badge counts are declared and never rendered

- **Location:** `components/layout/nav.tsx:14–15, 25–26, 33` (`badgeKey`); `NavLink:117–142`
- **Current behavior:** `NavItem.badgeKey` is typed and set on Obligations, Documents, and
  Notifications. `NavLink` never reads it. No badge renders anywhere.
- **Problem:** The single most useful ambient signal in an obligations product — *how many
  things need me* — is designed, typed, and absent.
- **Why it matters:** Without it, the user must visit each section to discover whether anything
  changed, which defeats the "we watch so you don't have to" promise. The dashboard carries the
  counts; navigation does not.
- **Proposed improvement:** Render a count badge from the summary query. Ensure it is announced
  to assistive tech (`aria-label` including the count, not a bare number).
- **Dependencies:** Summary endpoint for real counts.
- **Regression risk:** **Low.**

## P1-3 · The mobile navigation drawer claims to be modal but is not

- **Location:** `components/layout/app-shell.tsx:~75–90`
- **Current behavior:** `role="dialog" aria-modal="true"`, but — unlike `modal.tsx` and
  `command-palette.tsx`, which both use `useFocusTrap` — the drawer has **no focus trap and no
  Escape handler**.
- **Problem:** `aria-modal="true"` tells assistive technology that content outside is inert.
  It is not: keyboard and screen-reader users tab straight out of the "modal" into the page
  behind, with no way to close via Escape.
- **Why it matters:** This is an accessibility assertion that is false, on the primary
  navigation surface for every mobile user. The correct hook already exists in the codebase and
  is used correctly twice.
- **Proposed improvement:** Apply `useFocusTrap(panelRef, mobileNavOpen, close)`. Roughly a
  three-line change.
- **Dependencies:** None.
- **Regression risk:** **Low** — reuses a tested hook.

## P1-4 · Sign-out is icon-only and hidden where users do not look

- **Location:** `nav.tsx:153` (sidebar footer, icon only); `top-bar.tsx:110` (avatar → links to
  `/settings/profile`)
- **Current behavior:** Sign-out is an unlabelled icon in the sidebar footer. The account
  avatar — the conventional location — navigates to profile settings instead, with no menu.
- **Problem:** Users look for sign-out under their avatar. On mobile the sidebar is behind a
  drawer, so sign-out is two interactions deep and unlabelled.
- **Why it matters:** Compounds P0-1: the control is both hard to find *and* non-functional.
  On a shared device, difficulty signing out is a privacy problem.
- **Proposed improvement:** Make the avatar a menu (Profile · Settings · Sign out), and give
  the sidebar control a visible text label.
- **Dependencies:** P0-1 should land first.
- **Regression risk:** **Low.**

## P1-5 · Landing page pricing contradicts the billing screen

- **Location:** `app/landing-screen.tsx:192–193` vs `billing-settings.tsx:29–40`
- **Current behavior:** Landing offers *"$12 a month, or $99 a year."* Billing offers only
  `$12/month`. No annual option exists in the product.
- **Problem:** A user who converts on the annual price cannot find it.
- **Why it matters:** Pricing mismatch between marketing and product is a credibility problem
  at the exact moment of purchase intent, and a common source of chargebacks and support load.
- **Proposed improvement:** Make one authoritative source of plan definitions shared by both
  surfaces.
- **Dependencies:** Subscription audit should set the canonical plan model.
- **Regression risk:** **Low.**

## P1-6 · Privacy copy states encryption guarantees that no code provides

- **Location:** `privacy-settings.tsx:~44–48`
- **Current behavior:** *"Full identity numbers. Passport and account numbers are encrypted;
  even our own systems that read documents cannot decrypt them."* Stated in present tense as
  current fact.
- **Problem:** ADR-007 specifies this design; **no encryption code exists**, and no documents
  or secrets exist to encrypt. The `item_secrets` table exists and is never written.
- **Why it matters:** This is the load-bearing security claim of the entire product, presented
  to the user as an accomplished fact. It is the claim most likely to be quoted back in a
  security review, a press enquiry, or a dispute.
- **Proposed improvement:** Move to future/commitment tense until ADR-007 is implemented, or
  gate the section until then. The surrounding honesty framing makes the overstatement more
  damaging, not less.
- **Dependencies:** Field-level encryption implementation.
- **Regression risk:** **None** — copy only.

## P1-7 · Notification preferences do not persist

- **Location:** `app/(app)/settings/notifications/notification-settings.tsx:67–78, 171`
- **Current behavior:** All channel preferences in `useState`; "Preferences saved" toast; lost
  on reload.
- **Why it matters:** Reminder delivery is the core mechanism of the product. A user who turns
  off a channel they find intrusive will see it return, and will conclude the product ignores
  them. There is no reminder delivery system at all yet.
- **Proposed improvement:** Persist via a settings endpoint; until then do not claim "saved."
- **Dependencies:** Settings endpoint; reminder delivery.
- **Regression risk:** **Low.**

## P1-8 · Profile and household "Saved" toasts persist nothing

- **Location:** `profile-settings.tsx:~45`, `household-settings.tsx:~60`
- **Current behavior:** Toast "Saved — Profile updated." / "Household updated." Nothing is
  written. Real values *are* read from the database via the layout, so edits visibly revert on
  reload.
- **Why it matters:** Same false-success family; lower blast radius than P0 items but directly
  undermines "did it work?"
- **Proposed improvement:** Wire to endpoints, or make read-only until they exist.
- **Dependencies:** Profile/household update endpoints.
- **Regression risk:** **Low.**

## P1-9 · Theme toggle cannot return to "system"

- **Location:** `top-bar.tsx:88–100`
- **Current behavior:** Toggles between explicit light and dark only. The provider supports a
  three-state preference including `"system"`, but once a user clicks, no UI restores it.
- **Why it matters:** A user on OS-level automatic dark mode loses that behaviour permanently
  with one accidental click, and cannot recover it without clearing site data. The underlying
  provider is well built and already supports the fix.
- **Proposed improvement:** Three-state control (Light / Dark / System), or a "System" entry in
  the account menu from P1-4.
- **Regression risk:** **Low.**

## P1-10 · Simulated latency makes the product feel slower than it is

- **Location:** `lib/domain/queries.ts:30–36` (`LATENCY_MS = 220`)
- **Current behavior:** Every fixture read waits 220 ms deliberately, so skeletons render
  during development.
- **Problem:** Legitimate as a development tool; it will read as sluggishness in any
  demonstration, and it is on the path to being forgotten during cutover.
- **Why it matters:** "Calm and reliable" is undermined by an artificial delay on every
  navigation. 220 ms on top of real network latency post-cutover would be a genuine regression.
- **Proposed improvement:** Gate behind an explicit dev flag now; remove at cutover.
- **Regression risk:** **Low** (loading states are already independently tested).

---

# P2 — Refinement

| # | Location | Finding | Proposed | Risk |
|---|---|---|---|---|
| **P2-1** | `not-found.tsx:~30` | Hardcodes `⌘K` while `top-bar.tsx` correctly platform-detects (`Ctrl K` on Windows/Linux) | Reuse the shared shortcut reader | None |
| **P2-2** | `nav.tsx:166` | `HouseholdSwitcher` is a name that promises a capability it lacks | Rename to `HouseholdCard` until P0-13 lands | None |
| **P2-3** | `queries.ts` | `useItem` has zero consumers; there is no item-detail route despite items being a core concept | Add `/items/[id]`, or remove the hook | Low |
| **P2-4** | `queries.ts` | `useMarkNotificationsRead` has zero consumers — notifications can be shown but never marked read | Wire into the notifications screen | Low |
| **P2-5** | `household-provider.tsx` | `timezone`/`locale` live on the household object but hold the *viewer's* values (acknowledged in-code) | Move to `viewer` at cutover | Low |
| **P2-6** | Terminology | "Obligations" is precise but institutional; the nav says "Today" for the dashboard while the page header says "Good {morning}, {name}" | Decide one vocabulary and apply it in nav, headers, empty states, and marketing | None |
| **P2-7** | Terminology | "Entitlement" means *money owed to the household* in obligations UI and *plan quota* in the database | Rename one. Suggest "Owed to you" in UI | None |
| **P2-8** | `error-state.tsx` | 402 "cap exceeded" copy exists but no server can return 402 | Keep; note as pre-wired for the subscription audit | None |
| **P2-9** | `top-bar.tsx:100` | Notifications bell has no unread indicator | Add badge alongside P1-2 | Low |
| **P2-10** | `sign-in-form.tsx` | Success path calls `router.replace` + `refresh` with no visible transition; on a slow connection the button simply stays pending | Add explicit post-success state | Low |

---

# Screen-by-screen evaluation

Scored against the ten required criteria. **H** = handled well, **P** = partial, **✗** = problem.

| Screen | Hierarchy | Consistency | Density | CTA clarity | Terminology | Trust | A11y | Responsive | Feedback | Truthful |
|---|---|---|---|---|---|---|---|---|---|---|
| Landing | H | H | H | H | H | P | H | H | — | ✗ (P1-5) |
| Sign-up | H | H | H | H | H | ✗ | H | H | P | ✗ (P0-7) |
| Sign-in (password) | H | H | H | H | H | H | H | H | H | H |
| Sign-in (magic link) | H | H | H | H | H | ✗ | H | H | ✗ | ✗ (P0-5) |
| OAuth | H | H | H | H | H | ✗ | H | H | ✗ | ✗ (P0-6) |
| Onboarding | H | H | H | H | H | H | H | H | P | ✗ (P0-8) |
| Dashboard | H | H | H | H | P | H | H | H | P | ✗ (P0-9) |
| Obligations | H | H | H | H | P | H | H | H | P | ✗ (P0-9) |
| Obligation detail | H | H | H | H | H | H | H | H | H | ✗ (P0-9) |
| Documents | H | H | H | H | H | H | H | H | P | ✗ |
| Upload | H | H | H | H | H | ✗ | H | H | ✗ | ✗ (P0-10/11) |
| Household | H | H | H | P | H | H | H | H | ✗ | ✗ (P1-1) |
| Calendar / Timeline | H | H | H | H | H | H | H | H | — | ✗ (fixtures) |
| Notifications | H | H | H | P | H | H | H | H | ✗ | ✗ (P2-4) |
| Settings · profile | H | H | H | P | H | ✗ | H | H | ✗ | ✗ (P0-2, P1-1) |
| Settings · privacy | H | H | H | H | H | ✗ | H | H | ✗ | ✗ (P0-3/4) |
| Settings · billing | H | H | H | H | P | ✗ | H | H | ✗ | ✗ (P0-14) |
| Settings · notifications | H | H | H | H | H | P | H | H | ✗ | ✗ (P1-7) |
| Error / 404 / loading | H | H | H | H | H | H | H | H | H | H |
| Empty states | H | H | H | H | H | H | H | H | — | H |
| Sign-out | — | — | — | ✗ | H | ✗ | P | P | ✗ | ✗ (P0-1) |
| Session expiry | H | H | H | ✗ | H | P | H | H | ✗ | P (P0-12) |

**Integrations / Plaid:** no surface exists. Plaid has no code and is constitutionally
postponed; the privacy screen's *"Your email inbox, unless you connect it"* is the only hint of
an integration, and no connection flow exists. Recommend no integration UI until scope is
settled.

**Pattern:** the first eight columns are almost uniformly strong. The last two — *feedback* and
*truthfulness* — are where the product fails. That is a precise and encouraging diagnosis: the
design is not the problem.

---

# Proposed AutoBureau design-system consistency checklist

For reviewing any new or modified screen. Derived from what this codebase already does well —
this is largely a codification of existing practice, plus the guards its current failures show
are missing.

### 1. Truthfulness (new — and non-negotiable)
- [ ] Every enabled control has a handler that performs the action it names.
- [ ] **No success message is shown for an action that did not reach a server.** Success copy
      is written only after the call that justifies it exists.
- [ ] Copy describing security, encryption, deletion, or delivery is present-tense **only if
      implemented**; otherwise future-tense or absent.
- [ ] No identifier shown to a user (email alias, account reference) is synthesised client-side.
- [ ] Unimplemented features are disabled with an explanation, never enabled-and-inert.

### 2. Tokens and colour
- [ ] No hardcoded hex/rgb outside `globals.css`; all colour via semantic tokens.
- [ ] Status never expressed by colour alone — always paired with text or icon.
- [ ] Semantic tokens (`critical`/`warning`/`success`/`info`) never used for brand emphasis.
- [ ] Verified in light **and** dark; dark is designed, not inverted.

### 3. Typography and density
- [ ] Serif for `h1`–`h3`, sans for body — no exceptions.
- [ ] Numeric/currency columns carry `data-tabular` or live in a `<table>`.
- [ ] Money rendered through `formatMoney` from integer cents; never a float.
- [ ] Dates through `formatDate`; relative dates always paired with the absolute date.

### 4. Interaction and state
- [ ] Every async surface handles all four: loading (skeleton, not spinner), empty, error, success.
- [ ] Empty states state the good news first, teach the next step, and never use fear.
- [ ] Errors say what happened and what to do next — and **offer the recovery they name**
      (a 401 that says "sign in" must link to sign-in).
- [ ] Destructive actions require `ConfirmDialog`, state what is lost and for how long, and
      never route through a retention maze.
- [ ] Optimistic updates always paired with rollback.

### 5. Accessibility
- [ ] Focus visible via `:focus-visible`; never `outline: none` without a replacement.
- [ ] `aria-modal="true"` **only** with a real focus trap and Escape handler.
- [ ] Interactive elements ≥ 44 px touch target on mobile.
- [ ] Links navigate, buttons act — never a `<Link>` for a state change (see P0-1).
- [ ] Icon-only controls carry `aria-label`; primary destructive/security controls also carry
      a **visible** label.
- [ ] Live regions for async status; `aria-busy` on loading containers.
- [ ] Motion honours `prefers-reduced-motion` by collapsing, not shortening.

### 6. Responsive
- [ ] Verified at 375 px, 768 px, 1280 px.
- [ ] No horizontal page scroll; wide tables scroll in their own container.
- [ ] Mobile tab bar carries the four primary destinations; everything else in the drawer.
- [ ] Sticky elements respect `env(safe-area-inset-*)`.

### 7. Content
- [ ] No "oops", no apologies, no blame, no stack traces.
- [ ] One vocabulary per concept across nav, headers, empty states, and marketing.
- [ ] Plan/pricing facts come from one shared source, never duplicated in copy.
- [ ] Second person, plain language; institutional terms explained on first use.

---

## Sequencing note

The P0 list splits cleanly in two, and the split should drive the implementation batches:

**Batch A — honesty (low risk, high trust return, no dependencies).** P0-2, P0-3, P0-4, P0-6,
P0-10, P1-1, P1-6: disable or re-word controls that lie. Nothing here needs a backend, none of
it is architecturally risky, and it converts the product from *misleading* to *candidly
incomplete* — which is the posture the onboarding copy already achieves so well.

**Batch B — wiring (low risk, endpoints already exist).** P0-1 (sign-out), P0-5 (magic link),
P0-12 (session-expiry action), P1-3 (focus trap). Each connects a built, tested endpoint or
reuses an existing hook.

**Batch C — everything else** depends on household creation, the fixture→API cutover, or a
payment processor, and must wait for the identity and functionality audits.

Batches A and B together would remove every trust-breaking falsehood in the product without
touching a single architectural seam.
