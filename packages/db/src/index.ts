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
} from "./scoped.js";

export { outbox, type OutboxWrite } from "./outbox.js";

export { Prisma } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";
