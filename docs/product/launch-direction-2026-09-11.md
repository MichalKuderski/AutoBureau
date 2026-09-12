# Approved launch direction — 2026-09-11

Owner: founder approval in the release-director conversation. This records a go-forward decision, not evidence that G1 hypotheses passed.

## Decisions

- Continue the existing US/English caregiver-led household-record scope. One account holder manages household members; no multi-user login expansion.
- Use the approved calm evergreen/off-white visual direction. Preserve readable typography, clear hierarchy and accessible controls.
- Develop Free/Premium with provisional pricing of $12/month or $99/year. Validate unit economics and entitlement caps before enabling payments.
- Use Stripe-hosted Checkout and Customer Portal; test/sandbox mode first. Secure provider account access is still required.
- Defer Plaid and bank-data ingestion.
- Rework the brand toward a simple, memorable standalone name. No new name, public domain, logo or rename is approved.
- Keep the controlled staging confirmation identity intact.

The founder approved PR #4's final regression, CI/staging verification, temporary staging branch allowance/restoration, and merge after those gates. PR #4 was squash-merged as 3695e6cbb219d46674bbc5ffd891de2793fd002c on September 12 UTC.

## Execution order and evidence gates

1. Close the auth release: retain real confirmation/replay evidence and both final-head and post-merge staging results. Investigate any failed post-merge run rather than accepting green smoke alone.
2. Make household screens truthful and durable: scoped database reads, real empty/error/loading states, tenant-safe caches, persisted mutations and onboarding/settings. Remove sample records from real accounts. Check mobile layout, labels, contrast and keyboard behavior alongside each screen.
3. Complete secure document ingestion, quarantine/scan, processing and review, encrypted identifiers, provenance, outbox dispatch and reminders. No uncited date becomes an obligation; no network I/O in tenant transactions.
4. Complete recovery, privacy, export/deletion, retention and operational diagnostics. Provider errors need actionable, redacted traces; never retry a credential redemption blindly.
5. Add Stripe test-mode lifecycle coverage: signature verification, durable event handling, idempotency, reconciliation, entitlement sync, cancellation, renewal and failed-payment grace. Success-page navigation alone never grants entitlement.
6. Verify complete user journeys with real tenant-isolation tests, retries/failures, document and payment lifecycles, responsive/accessibility checks, and a final founder staging acceptance.
7. Produce a separate exact-SHA release packet with configuration differences, rollback and remaining external/legal requirements before requesting consequential rollout approval.

Name selection/clearance runs alongside steps 2–4. Avoid a mass rename until the name and domain route are settled.

## Explicitly retained gates

Production access/mutation/deployment, later launch-branch merge with deployment consequences, live charging, domain purchase/DNS, irreversible provider actions and public launch require separate approval. No such action is authorized by the roadmap approval.

Counsel/business-identity details and secure Stripe access remain external dependencies. Credentials must not be pasted into chat. No successful G1 validation, legal compliance, customer recall study or public-launch readiness is claimed.

