/**
 * @autobureau/db — the only sanctioned path to household data.
 *
 * Note what is NOT exported: the bare PrismaClient. Application code cannot obtain
 * an unscoped handle from this package by accident; it must go through
 * `Database.withHousehold` (RLS-scoped) or the loudly-named dispatcher escape hatch.
 */
export {
  Database,
  createDatabase,
  ScopeError,
  type ScopedClient,
  type DispatcherClient,
  type GlobalClient,
  type GlobalTable,
  type ScopedTransactionOptions,
  type HouseholdScopeOptions,
} from "./scoped.js";

/**
 * Audit surface (ADR-009 D5/D6). `runAsUser`/`runAsSystem` establish who is acting for
 * everything inside them; the extension and the scoped client do the rest. The only
 * thing a handler calls directly is `recordAudit`, and only for actions no
 * write-interceptor can observe.
 */
export {
  runAsUser,
  runAsSystem,
  currentActor,
  recordAudit,
  AuditError,
  type Actor,
  type AuditWriter,
} from "./audit.js";

export { outbox, type OutboxWrite } from "./outbox.js";

export { Prisma } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";

export * from "./jobs.js";
export * from "./document-scans.js";
export * from "./deletion-journal.js";
export * from "./document-cancellation.js";
export * from "./document-period.js";

export * from "./local-erasure.js";

export * from "./privacy-inventory.js";
export * from "./restore-authority.js";

export * from "./privacy-export.js";
export * from "./account-security.js";

export * from "./stripe-test-inbox.js";

export * from "./stripe-test-reconciliation.js";

export { runWithSensitiveScope } from "./sensitive-scope.js";

export { createLocalExportVault } from "./local-export-artifact.js";

export { readHouseholdSessionAdmission, AccountSecurityRefused } from "./account-security.js";
export { runWithHouseholdSessionScope } from "./sensitive-scope.js";

export { createLocalTestBillingDatabase } from "./test-billing-runtime.js";

export { readEffectivePlan,consumesHumanAllowance,managedHumanCount,type EffectivePlan } from "./plan-policy.js";

export * from "./document-processing.js";
export {readDocumentQuota} from './document-quota.js';
export * from "./local-export-archive.js";
export { localCleanCustody } from "./local-clean-custody.js";
export { readLocalPlaidConnections, requestLocalPlaidUnlink, requestLocalPlaidReconnect } from "./plaid-local-lifecycle.js";
