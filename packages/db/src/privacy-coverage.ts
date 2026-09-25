/**
 * Privacy completeness contract (Founding Principles §7.10; ADR-018/019). Every table that
 * carries household data needs a conscious, reviewed answer to two questions:
 *   1. deletion — is it enumerated by the deletion inventory, or excluded, and why?
 *   2. export   — which export category carries it, or why is it omitted?
 * A control test enumerates the live schema and fails when a table has no answer, so a new
 * table cannot silently escape deletion or export. Values are reasons, never data.
 */
export const DELETION_INVENTORY_EXCLUSIONS: Readonly<Record<string, string>> = Object.freeze({
  audit_log: "retained-evidence: audit trail kept as ADR-019 suppression evidence (action codes, no content)",
  household_deletions: "retained-evidence: the deletion journal itself",
  deletion_resources: "retained-evidence: the deletion journal itself",
  deletion_attempts: "retained-evidence: the deletion journal itself",
  deletion_observations: "retained-evidence: the deletion journal itself",
  journal_retirement_runs: "retained-evidence: ADR-019 retirement planning journal",
  journal_retirement_decisions: "retained-evidence: ADR-019 retirement planning journal",
  journal_retirement_observations: "retained-evidence: ADR-019 retirement planning journal",
  journal_retirement_holds: "operator-record: incident/legal hold control outside the application authority",
  household_users: "retained-anchor: membership anchors deletion suppression evidence (ADR-019)",
  household_members: "erased-by-component: account-household stage (local-erasure.ts), counted by the independent observer",
  entitlements: "erased-by-component: account-household stage (local-erasure.ts), counted by the independent observer",
  idempotency_keys: "erased-by-component: account-household stage (local-erasure.ts), counted by the independent observer",
  inbound_emails: "no-writer: email intake is not built and nothing writes this table; activating intake requires inventory and erasure coverage first",
});

/**
 * Every public table WITHOUT a household_id column, classified. `household-via:<parent>` tables hold
 * household data through a cascading parent (the control verifies the FK, the cascade and that the
 * deletion inventory enumerates them); `account-scope` tables belong to the sign-in account, which
 * household deletion does not cover; `household-anchor` is the household row; `global` tables hold
 * no personal data. A new table without an answer here fails the completeness control.
 */
export const NON_HOUSEHOLD_TABLES: Readonly<Record<string, string>> = Object.freeze({
  households: "household-anchor: kept as the ADR-019 suppression anchor; name and alias replaced at the account-household stage; exported (household)",
  item_secrets: "household-via:items: identifier-grade ciphertext (ADR-007); inventoried and erased; exported as a count only, never values",
  document_uploads: "household-via:documents: upload intent and object key; inventoried and erased with the document",
  notification_deliveries: "household-via:notifications: delivery transport journal; inventoried and erased",
  users: "account-scope: sign-in identity; exported (account); outside household deletion (signInAccount not-in-scope)",
  user_profiles: "account-scope: display name, locale, timezone, onboarding; exported (profile); outside household deletion",
  notification_preferences: "account-scope: per-user channel settings; exported (notificationPreferences); outside household deletion",
  vendors: "global: shared vendor rulebook; no personal data",
  auth_rate_limits: "global: unkeyed SHA-256 bucket digests (reversible with a wordlist, documented), minutes of retention, no foreign key to accounts (ADR-013 D3)",
  plan_catalog: "global: product plan configuration",
  local_plan_activation: "global: local TEST activation switch",
  _prisma_migrations: "global: migration ledger (no runtime authority)",
});

/** `category:<name>` = carried by that export v3 category; `omitted:<reason>` = deliberately not exported. */
export const EXPORT_COVERAGE: Readonly<Record<string, string>> = Object.freeze({
  documents: "category:documents",
  document_custodies: "category:documentWork",
  document_processing: "category:documentWork",
  entitlements: "category:entitlements",
  household_members: "category:members",
  household_users: "category:household",
  items: "category:items",
  obligations: "category:obligations",
  reminders: "category:reminders",
  notifications: "category:notifications",
  audit_log: "category:auditTrail",
  plaid_local_items: "category:financialConnections",
  plaid_local_accounts: "category:financialAccounts",
  plaid_local_transactions: "category:financialTransactions",
  stripe_test_states: "category:testSubscription",
  document_chunks: "omitted:derived-index (search chunks; the source documents and filed records are exported)",
  document_results: "omitted:internal-journal (provenance of filed records; the filed items/obligations are exported)",
  document_result_reviews: "omitted:internal-journal (owner approvals appear in the audit trail)",
  document_period_decisions: "omitted:internal-journal (owner decisions appear in the audit trail)",
  document_scans: "omitted:internal-journal (scanner verdict journal)",
  document_scan_attempts: "omitted:internal-journal (scanner attempt journal)",
  account_security_challenges: "omitted:security-journal (one-use challenge evidence; never exported)",
  idempotency_keys: "omitted:transport (request replay protection)",
  outbox_events: "omitted:transport (delivery intents)",
  job_deliveries: "omitted:transport (queue delivery journal)",
  job_inbox: "omitted:transport (consumer inbox journal)",
  local_export_artifacts: "omitted:internal-journal (export artifact capability journal)",
  plaid_local_subjects: "omitted:provider-binding (incarnation binding, no user data beyond the connection)",
  plaid_local_exchanges: "omitted:provider-binding (exchange operation journal)",
  plaid_local_credentials: "omitted:provider-credential (encrypted custody is never exported)",
  plaid_local_item_routes: "omitted:provider-binding (webhook routing digest)",
  plaid_local_cursors: "omitted:provider-binding (sync cursor)",
  plaid_local_webhooks: "omitted:provider-binding (verified webhook signal journal)",
  stripe_test_bindings: "omitted:provider-binding (billing-provider identifiers)",
  stripe_test_notices: "omitted:provider-binding (billing webhook journal)",
  stripe_test_intents: "omitted:provider-binding (billing reconciliation journal)",
  household_deletions: "omitted:retained-evidence (deletion journal; status is shown in settings)",
  deletion_resources: "omitted:retained-evidence (deletion journal)",
  deletion_attempts: "omitted:retained-evidence (deletion journal)",
  deletion_observations: "omitted:retained-evidence (deletion journal)",
  journal_retirement_runs: "omitted:retained-evidence (retirement planning journal)",
  journal_retirement_decisions: "omitted:retained-evidence (retirement planning journal)",
  journal_retirement_observations: "omitted:retained-evidence (retirement planning journal)",
  journal_retirement_holds: "omitted:operator-record (hold control)",
  inbound_emails: "omitted:no-writer (email intake is not built)",
});
