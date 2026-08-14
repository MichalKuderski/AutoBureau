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
