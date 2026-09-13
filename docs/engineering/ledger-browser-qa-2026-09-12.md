# Local ledger browser verification — September 12, 2026

This verifies an implementation increment on `codex/launch-foundations`, not a completed staging release candidate. The local production build uses the real application routes and disposable PostgreSQL 18 with `app_user` RLS. Its loopback-only GoTrue-shaped issuer signs test JWTs; it is not evidence of a new hosted Supabase confirmation test. No Production system or the controlled staging confirmation identity was used.

## Observed journeys

| Journey | Result |
| --- | --- |
| Sign in to the disposable account | PASS — reaches authenticated dashboard |
| Empty dashboard | PASS — zero real records; no sample coverage percentage or digest date |
| Household name save and reload | PASS — persisted name appears in settings and navigation |
| Profile name/timezone save and reload | PASS — stored name and Mountain/Denver selection persist |
| Add and edit a person | PASS — list and navigation counts update; Enter opens editing |
| Cancel archive | PASS — person remains active |
| Archive and restore | PASS — active/archived lists and counts reflect persisted state |
| Exceed two-person free-plan capacity | PASS — real 402 rejection, actionable message, failed form values retained |
| Populated dashboard | PASS after correction — the action-needed deadline also appears in the upcoming panel |
| Item list and keyboard drawer | PASS — only the local household's seeded item and masked representation appear |
| Empty member filter | PASS after correction — describes that person, with a working “See everyone” recovery |
| Document list and review-filter URL | PASS — persisted document appears in All; dashboard review link selects Needs review |
| Complete obligation and reload | PASS — $120.50 user-reported outcome persists as 12050 cents |
| Reopen and dismiss/cancel | PASS — status and current outcome change only after server confirmation |
| Search and Enter navigation | PASS — real obligation query opens its valid detail route |
| Calendar day detail and next month | PASS — saved deadline appears on September 19; October does not include it |
| Mobile navigation/person form | PASS at 390 px; Escape closes the modal and restores focus to its trigger |
| Narrow layout and dark theme | PASS at 320 px; document width equals viewport width; override reset afterward |
| Sign out | PASS — returns to the sign-in screen |
| Browser diagnostics | No fatal console errors or warnings in the captured checks. The capacity 402 was intentional. |

Routes exercised: `/sign-in`, `/dashboard`, `/settings`, `/settings/profile`, `/household`, `/documents`, `/calendar`, and the local obligation detail. This is not exhaustive route/control coverage. Browser tooling refused direct navigation to the JSON household API after sign-out; unauthenticated 401 behavior is covered by the real-database integration suite, not claimed as a browser-network capture here.

## Automated evidence

- Production build and lint/typecheck pass for the API cutover. Small follow-up copy/ARIA changes receive targeted checks.
- 986 repository unit checks pass, including 884 web checks.
- Full web integration: 325/325 pass. Final affected registry/lifecycle rerun: 24/24 pass.
- Affected UI/date checks: 66/66 pass, including failed continuation preserving loaded records and failed completion preserving its form.
- Tenant tests use `app_user`; admin access only seeds/inspects disposable fixtures.

The separate published `d09ac057f0cbd198a9de0d2a02a0c66b7f85d138` increment passed CI 34703871170 and Preview 34703871178 (smoke 17/17, acceptance 57/57). The earlier intermittent signup refusal remains open; that passing run is not a causal fix.

## Remaining release gaps

Notification fixtures, document processing/review/reminder dispatch, recovery/MFA/privacy and Stripe lifecycle still require implementation and end-to-end evidence. A cancelled reminder is not proof of a functioning reminder sender. A disabled review save is not a completed document workflow. Refer to `launch-risk-register.md`; Production preflight remains NO-GO.

## Activity history follow-up

The rebuilt local application shows four saved obligation lifecycle actions instead of sample history. Documents correctly has no audit history for the admin-seeded fixture; switching back to Deadlines restores the saved entries, and the completion entry opens the current obligation. Date headings and times follow the saved Denver timezone. Captured browser warning/error logs are empty. Activity tests cover microsecond pagination, cross-tenant targets, filter-bound cursors, failed reads/retry and timezone day boundaries (5 integration + 12 UI checks).

## Manual record follow-up

A new record was created in the disposable local household, edited, and opened with Enter after reload. Its name/provider, Alex Local association, $125.50 amount and September 12, 2027 expiry persist. A read-only database check confirms exactly one record, 12550 cents, unverified status, one create audit, one update audit and two outbox intents. Records activity displays those two changes with the current label.

At 390 px the form fits the viewport and scrolls; an invalid 12.345 amount is rejected without a write. Cancel restores focus to Add item after removing an autofocus conflict discovered during QA. The viewport override was reset. Captured warning/error console logs are empty. Native date changes were committed with keyboard input, since automation fill alone only changed the visible native control value. Full web integration now passes 336/336; repository units pass 990; the final focus/form/API rerun passes 22/22. Final build/lint/typecheck pass.

## Persistent setup follow-up

`/onboarding`, `/onboarding/census`, `/onboarding/document` and `/onboarding/ready` now load and save through the scoped API. In the disposable household, the two saved people resume correctly. Home insurance and Vehicle selections survive reload, create two unverified records, and show two dateless claims without scheduling anything. Finishing setup again leaves all record/audit/outbox counts unchanged: 4 items total, 2 people, 1 pre-existing obligation, 0 reminders, 2 census create audits and 2 census outbox intents. The final dashboard correctly displays 0 of 2 setup records confirmed despite another unrelated verified record.

The rebuilt Ready page fits at 390 px without horizontal overflow; its button saves and returns to the real dashboard. Progress labels do not announce earlier steps as completed merely from the current URL. Console warning/error capture is empty, and the viewport override was reset. Final build/lint/typecheck pass, all 987 repository units pass, and the final affected onboarding/registry integration checks pass 24/24. The earlier full web integration run passes 344/344; coverage adds one new boundary check. These local checks still require exact-SHA hosted staging QA later.

## Manual deadline follow-up

The local browser creates a confirmed deadline associated with Alex Local and the manual renewal record, then edits the same deadline's title and due time. Reload confirms September 20, 2026, 5:30 PM America/Denver and $125.50. Read-back confirms exactly one row and the two expected audit/outbox actions. The timeline links both creation and editing to its real detail route.

The form rejects March 8, 2026 at 02:30 in Denver as nonexistent and requires a choice for November 1 at 01:30. Both repeated-hour choices appear; the second is selectable. Direction and priority controls are operable. The validation draft is cancelled. Native date/time changes use keyboard events because automation fill alone does not reliably commit browser-native controls.

At 390 px the edit form scrolls without horizontal overflow; Cancel restores focus to Edit deadline. The viewport override was reset. Captured warning/error console logs are empty. Final build/lint/typecheck, 353 integration checks and 996 repository units pass. Reminder sending, snooze/recurrence and source-window editing remain separate open requirements.


## Notifications and preferences

Rebuilt local application / disposable issuer and PostgreSQL only. Empty feed contains no fixture fallbacks. Three explicitly seeded local notices test a deadline destination, a security notice with distinct presentation and a missing destination rendered as plain text. Individual read via keyboard, mark-all-read, unread-empty state and reload persist. The deadline link opens the exact saved obligation.

All twelve editable kind/channel checkboxes were toggled and saved; the three security controls remain checked/disabled. Explicit urgent opt-in, Tuesday digest, quiet hours 22:15–07:45 and digest time 18:30 America/Denver survive reload. Equal boundaries show validation and do not write. Restoring the saved boundary and saving again produces no database delta. The saved setup namespace is unchanged. Three notices remain read, three seeded channel deliveries remain queued with no sent timestamp, twelve preference rows persist, one preference-change action and two read-batch actions exist. No provider send occurred. Native time fields were committed with keyboard events after fill.

The preference layout fits 390 and 320 CSS pixels without horizontal overflow. Captured console warnings/errors are empty. UI tests cover fetch failure, server save refusal, retained edits, owner restrictions and successful retry; real-database tests cover recipient isolation, bounded batches, malformed/foreign cursors, no-op writes, security suppression refusal and unknown stored versions.
