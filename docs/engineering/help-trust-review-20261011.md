# Help and trust surface review — 2026-10-11

Local review candidate, based on PR14 head 37fd91a. No publication approval yet.
Source-review b960863 and rejection semantics are separate changes and are not represented as shipped here.

## Audit and priorities

The existing evergreen/warm-canvas design system already supports a calm professional presentation. This change retains its fonts, colors, reduced-motion support and dark theme, and adds consistent information-page spacing, topic navigation, native disclosure controls and a shared footer. No new dependency, tracking, remote asset or provider call.

P0 findings: no public FAQ/privacy/terms/security pages; landing closing claim implied reliable deadline prevention; upload and onboarding copy implied live processing and deletion. Replace those promises with accurate preview limits. Preserve disabled intake and all provider gates.

P0 unresolved: operator/legal identity, verified public contacts, final privacy notice and terms, verified data-flow/vendor inventory, retention and backup lifecycle, key custody, scanner, recovery and export/deletion operational checks. Architecture document 13 describes intended posture, not proof. Status pages explicitly say they are not a complete policy or reviewed agreement. Contact and legal owner facts are kept in private review material, not repository content.

P1: existing test-account dashboard, obligations, documents and notification settings provide a useful weekly-review path. Help links to those surfaces rather than introducing reminders, automatic processing, gamification or shared-access promises. Additional search/version-history/permissions improvements require their own scoped implementation and verification.

## Evidence-to-copy map

| Surface | Implementation evidence | Copy boundary |
|---|---|---|
| Upload | UploadScreen and DocumentStep render disabled UploadDropzone | No real sensitive uploads; optional onboarding step |
| AI | services/ai live OpenAI boundary remains disabled | Offline/synthetic experiments are not live extraction |
| Data access | middleware exact allowlist; scoped database access | Describe access control without certification claims |
| Export | server/privacy/export-storage.ts refuses hosted production; local synthetic mount only | Hosted export is not ready for real-data use |
| Deletion | existing gated lifecycle implementation and Privacy & data UI | Request is not evidence of completed deletion; no promised retention time |
| Payments/connections | existing live-disabled and sandbox boundaries | No real payment or bank details for tests |
| Source review | b960863 is a separate unpublished branch | No claim that source-opening/correction works generally |

Four exact static paths are public: /help, /privacy, /security, /terms. No wildcard, API, nested route, household query or mutation is added. Tests pin the allowlist and reject nested paths. Authenticated help links retain normal sign-in requirements.

## Legal/content owner review before publication

Confirm legal operator identity and markets/age policy; establish and verify monitored support/privacy/security contacts; review full data categories, purposes, recipients, rights, retention, international transfers and incident handling. Confirm payment/cancellation policy, third-party content permissions and service license. Do not infer these from prospective architecture. Public status pages are interim notices, not substitutes for counsel-approved policies or operational evidence.

Copyright ownership attribution must be confirmed by the owner; the footer uses the product name/tagline without inventing a corporate rights holder. No new jurisdiction, certification, encryption, model-training or deletion guarantee is made.

## Validation

Validation results and browser evidence will be recorded with the local candidate. Browser checks cover public screens only, not live account or document processing. No production readiness or full E2E claim.

Validated locally: full seven-workspace build, all seven workspace typechecks (11 Turbo tasks including dependencies), focused lint and all 1,736 web tests passed. The first full-web attempt in the restricted sandbox could not spawn/listen for existing loopback tests; the rerun with explicit network permission passed, without hosted calls. Focused route/help/upload/onboarding suite: 147 tests.

Local Chromium inspected 20 page/viewport combinations: /, /help, /privacy, /security and /terms at desktop, mobile light/dark and 320px reflow. Keyboard disclosure, topic navigation, skip-link focus and denial of four nested information paths passed in every mode; zero page errors or external browser requests. Screenshots visually inspected for desktop FAQ, mobile FAQ and dark privacy notice. Development-server screenshots include Next's development indicator. No automated WCAG conformance or hosted E2E claim.

Reproduce using an existing Playwright installation (no download required):
`PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node scripts/help-trust-browser.mjs`.
The script starts only a loopback server, has no application credentials and writes evidence/screenshots to a temporary directory.

### PR15 onboarding review follow-up

The document-step safety alert now links directly to `/security`, closing the missing
onboarding entry point identified in review discussion `discussion_r4242052444`.
The link has descriptive text, an underline and keyboard focus; uploads remain disabled
and Continue remains available. No authorization, provider or data-handling behavior changes.

The affected web aggregate passed 1,737 tests; the document-step suite passed 11.
Web typecheck and focused lint passed. The initial aggregate could not bind loopback
servers under the default sandbox; it passed with explicit local-network permission.
`scripts/onboarding-security-browser.mjs` checks the real document-step component,
security page and styles in an isolated loopback fixture with a synthetic draft.
Tab/Enter navigation to Security status, the footer security link, browser Back,
disabled upload and no horizontal overflow passed at desktop, mobile, dark and 320px.
No page errors or external requests occurred. Final mobile and 320px screenshots were
visually checked for readable wrapping and focus visibility. This fixture excludes
hosted authentication and does not establish full onboarding E2E coverage.

Copilot quota prevented a new Copilot review; do not record it as a review pass.
