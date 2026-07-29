import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * The scoped database client — implements review amendment A1 (blocker F-01).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS THE ONLY DOOR
 * ------------------------------------------------
 * Tenant isolation in AutoBureau is enforced twice: in code (this module) and in
 * the database (RLS policies, migration 20260728000001_rls). This module is the
 * only sanctioned way for application code to reach household-scoped data, so
 * that the two layers cannot drift apart.
 *
 * The load-bearing mechanic, and the trap the architecture review caught:
 * Postgres GUCs set with `SET LOCAL` (equivalently `set_config(..., true)`) live
 * and die with a transaction. Outside a transaction the setting silently does not
 * apply — under RLS that means *every query returns zero rows*. Worse, the naive
 * fix (a session-level `SET`) survives on a pooled connection and leaks one
 * household's scope into the next request that borrows it. Therefore:
 *
 *   every scoped unit of work is wrapped in an explicit interactive transaction
 *   whose FIRST statement establishes the scope.
 *
 * Consequences we accept deliberately (doc 06 §5):
 *   - Interactive transactions pin a pooled connection for their duration, so
 *     scoped work must stay SHORT. Never perform network I/O (model calls, storage,
 *     webhooks) inside `withHousehold`. Read what you need, close the transaction,
 *     then do the slow thing. The 5s timeout below turns a violation into a loud
 *     failure in development rather than a silent pool exhaustion in production.
 *   - Pool-wait p95 is a paged metric (doc 10 §4); if it degrades, the pre-agreed
 *     escape hatch is relocating /v1 onto a long-lived Node service — a redeploy,
 *     not a rewrite, because the API is portable by construction (ADR-008).
 */

/** Scoped work may not reach for raw-unsafe escapes; use parameterized `$queryRaw`. */
export type ScopedClient = Omit<Prisma.TransactionClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

/** Unrestricted transaction client — dispatcher/maintenance only. */
export type DispatcherClient = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ScopeError extends Error {
  override name = "ScopeError";
}

export interface ScopedTransactionOptions {
  /** Hard ceiling on a scoped unit of work. Short by construction — see file header. */
  timeoutMs?: number;
  /** How long to wait for a free pooled connection before failing. */
  maxWaitMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 2_000;

export class Database {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run `fn` with tenant scope established for `householdId`.
   *
   * The scope is set via `set_config(name, value, is_local => true)` rather than
   * `SET LOCAL`: identical semantics, but it is a function call and therefore takes
   * a bind parameter. `SET LOCAL` would require string interpolation of a value
   * that ultimately originates from a request header — a SQL-injection sink we
   * simply refuse to create. The UUID assertion below is defence in depth.
   */
  async withHousehold<T>(
    householdId: string,
    fn: (tx: ScopedClient) => Promise<T>,
    options: ScopedTransactionOptions = {},
  ): Promise<T> {
    if (!UUID_RE.test(householdId)) {
      throw new ScopeError(`householdId is not a valid UUID: ${JSON.stringify(householdId)}`);
    }
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('request.household_id', ${householdId}, true)`;
        return fn(tx as ScopedClient);
      },
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      },
    );
  }

  /**
   * Escape hatch for the two jobs that legitimately span households: the outbox
   * dispatcher and the deletion cascade (doc 06 §5). Deliberately verbose and
   * greppable — CI asserts it appears only in allow-listed modules.
   *
   * Requires a client connected as `app_dispatcher` (BYPASSRLS). Calling it on an
   * `app_user` connection is not a security hole, just an empty result set.
   */
  async unsafeAcrossAllHouseholds<T>(
    reason: string,
    fn: (tx: DispatcherClient) => Promise<T>,
    options: ScopedTransactionOptions = {},
  ): Promise<T> {
    if (!reason || reason.length < 8) {
      throw new ScopeError("unsafeAcrossAllHouseholds requires a documented reason");
    }
    return this.prisma.$transaction(fn, {
      timeout: options.timeoutMs ?? 30_000,
      maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    });
  }

  /** Health probe. Deliberately unscoped and trivial. */
  async ping(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export function createDatabase(databaseUrl?: string): Database {
  // Branch rather than pass a union-typed options object: Prisma's `Subset<>`
  // constraint plus exactOptionalPropertyTypes rejects `{...} | {}`.
  const prisma = databaseUrl
    ? new PrismaClient({ datasourceUrl: databaseUrl })
    : new PrismaClient();
  return new Database(prisma);
}
