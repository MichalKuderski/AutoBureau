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

Timeline/notification fixtures, persisted onboarding, manual record creation, document processing/review/reminder dispatch, recovery/MFA/privacy and Stripe lifecycle still require implementation and end-to-end evidence. A cancelled reminder is not proof of a functioning reminder sender. A disabled review save is not a completed document workflow. Refer to `launch-risk-register.md`; Production preflight remains NO-GO.
