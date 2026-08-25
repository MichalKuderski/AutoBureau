import { PrismaClient, type Prisma } from "@prisma/client";
import type { AuditAction } from "@autobureau/contracts";
import { auditExtension, currentActor, withAuditUnit, type AuditWriter } from "./audit.js";

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

/**
 * Tables reachable with no tenant scope at all (ADR-013 D2).
 *
 * This union IS the fence. Adding a member widens an anonymous, unauthenticated write
 * capability, so it is a deliberate edit to this file rather than a call-site decision —
 * `pnpm typecheck` rejects any other table, and a CI guardrail pins this list textually so
 * that widening it cannot pass as a one-line diff nobody notices.
 */
export type GlobalTable = "auth_rate_limits";

/** Defence in depth over the union, in the same spirit as the UUID assertions below. */
const GLOBAL_TABLES: ReadonlySet<string> = new Set<GlobalTable>(["auth_rate_limits"]);

declare const GLOBAL_CLIENT: unique symbol;

/**
 * The client `withGlobalTable` hands out.
 *
 * Branded so a `ScopedClient` cannot be passed where a `GlobalClient` is required: the two
 * are otherwise structurally identical, and TypeScript would let one stand in for the other
 * silently. The opposite direction is not blocked by the type system, and does not need to
 * be — a global client used for tenant work reaches a transaction with no GUC set, where
 * every household policy predicate is NULL and every scoped table returns zero rows and
 * refuses every write. That direction fails closed at the database.
 */
export type GlobalClient = Omit<
  Prisma.TransactionClient,
  "$executeRawUnsafe" | "$queryRawUnsafe"
> & { readonly [GLOBAL_CLIENT]: "global" };

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

export interface HouseholdScopeOptions extends ScopedTransactionOptions {
  /**
   * The domain verb for this unit of work (ADR-009 D6). Required for operations whose
   * CRUD-derived action would be ambiguous — one `obligation.update` covers dismiss,
   * complete and reopen — and rejected by the audit extension when omitted there.
   */
  verb?: AuditAction;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 2_000;

/** Named so the extended client's type can be recovered; `$extends` erases to unknown. */
function extendWithAudit(prisma: PrismaClient) {
  return prisma.$extends(auditExtension);
}
type AuditedClient = ReturnType<typeof extendWithAudit>;

export class Database {
  /**
   * The audit extension must be applied before any transaction opens: a
   * `Prisma.TransactionClient` cannot be extended after the fact. Held separately from
   * `prisma`, which stays the plain handle for lifecycle calls.
   */
  private readonly client: AuditedClient;

  constructor(private readonly prisma: PrismaClient) {
    this.client = extendWithAudit(prisma);
  }

  /**
   * Phase 1 of the authenticated request (ADR-009 D5): principal scope, no household.
   *
   * Establishes `request.user_id` and deliberately nothing else, which is the condition
   * the two self-read policies are guarded on. Inside this transaction the principal can
   * read its own `household_users` and `households` rows — and nothing else; household
   * data stays invisible because no household is selected.
   *
   * Read-only by construction. The audit extension refuses any mutation that runs
   * without a scoped unit of work, and phase 1 deliberately does not open one: deciding
   * *which* household a request belongs to is not a moment that should be changing rows.
   */
  async withPrincipal<T>(
    userId: string,
    fn: (tx: ScopedClient) => Promise<T>,
    options: ScopedTransactionOptions = {},
  ): Promise<T> {
    if (!UUID_RE.test(userId)) {
      throw new ScopeError(`userId is not a valid UUID: ${JSON.stringify(userId)}`);
    }
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('request.user_id', ${userId}, true)`;
        return fn(tx as unknown as ScopedClient);
      },
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      },
    );
  }

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
    options: HouseholdScopeOptions = {},
  ): Promise<T> {
    if (!UUID_RE.test(householdId)) {
      throw new ScopeError(`householdId is not a valid UUID: ${JSON.stringify(householdId)}`);
    }
    return withAuditUnit(householdId, options.verb, (flush) =>
      this.client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('request.household_id', ${householdId}, true)`;
          // Phase 2 carries the principal too, so `audit_log.actor_id` is stamped by the
          // database rather than by anything this process asserts (D5). With a household
          // set, the phase-1 self-read policies are inert — their guard is
          // `app.current_household() IS NULL` — so this widens no read.
          const actor = currentActor();
          if (actor?.type === "user") {
            await tx.$executeRaw`SELECT set_config('request.user_id', ${actor.userId}, true)`;
          }
          const result = await fn(tx as unknown as ScopedClient);
          // Before commit, inside the same transaction: audit rows and the domain rows
          // they describe live or die together.
          await flush(tx as unknown as AuditWriter);
          return result;
        },
        {
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
        },
      ),
    );
  }

  /**
   * Principal scope with writes permitted — identity mirroring only (ADR-009 D8).
   *
   * Deliberately separate from `withPrincipal`. That method is read-only by
   * construction because deciding *which* household a request belongs to is not a
   * moment that should change rows, and quietly making it writable would remove a
   * guard rather than add a capability. This is the one operation that legitimately
   * writes with no household in scope: the `users` / `user_profiles` rows that mirror
   * an authenticated principal into this database before any household exists.
   *
   * The audit unit it opens carries no household, so the rows it flushes rely on the
   * `self_audit_insert` policy — which admits them only when `actor_id` matches the
   * principal established here. Attribution is therefore stamped by the database from
   * the same setting the policy checks; nothing this process asserts can change it.
   */
  async withIdentity<T>(
    userId: string,
    fn: (tx: ScopedClient) => Promise<T>,
    options: ScopedTransactionOptions = {},
  ): Promise<T> {
    if (!UUID_RE.test(userId)) {
      throw new ScopeError(`userId is not a valid UUID: ${JSON.stringify(userId)}`);
    }
    return withAuditUnit(null, undefined, (flush) =>
      this.client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('request.user_id', ${userId}, true)`;
          const result = await fn(tx as unknown as ScopedClient);
          await flush(tx as unknown as AuditWriter);
          return result;
        },
        {
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
        },
      ),
    );
  }

  /**
   * The one door for tables that belong to no tenant (ADR-013 D2, blueprint P1-08).
   *
   * WHY IT HAD TO EXIST, AND WHY IT IS NOT ANY OF THE OTHER FOUR
   * ------------------------------------------------------------
   * Rate limiting a sign-in runs *before* a token is verified: there is no principal and no
   * household, so `withPrincipal`, `withHousehold` and `withIdentity` all fail at their
   * first argument. `unsafeAcrossAllHouseholds` would work and must never be used — it runs
   * on the BYPASSRLS dispatcher role, and the blast radius of a bug on a public,
   * unauthenticated endpoint is then the entire tenant set. None of those four is widened
   * by this method; it sits beside them.
   *
   * IT SETS NO GUC, AND THAT IS THE SAFETY PROPERTY
   * -----------------------------------------------
   * Neither `request.household_id` nor `request.user_id` is established here, deliberately.
   * With both unset, `app.current_household()` and `app.current_user_id()` return NULL,
   * every household policy predicate evaluates to NULL, and every household-scoped table
   * returns zero rows and rejects every write — the fail-closed behaviour migration
   * `20260728000001_rls` was built around. So the narrowness of this method is enforced by
   * the database, not only by its signature: a query issued through it that named `items`
   * would not leak, it would return nothing.
   *
   * It runs on the ordinary `app_user` connection — never `app_dispatcher`, never
   * `service_role` — and opens NO audit unit, because there is no actor. `audit_log`'s
   * insert policy requires a household or the dispatcher role, so a row written from here
   * would be both impossible to insert and wrong to want: a rate-limit decision is not a
   * household-attributable domain action. The observability record is its account.
   *
   * Callers must use parameterized `$queryRaw`. The Prisma model delegates would be
   * intercepted by the audit extension, which refuses a mutation with no unit of work in
   * scope — correctly, and that refusal is not something to work around.
   */
  async withGlobalTable<T>(
    table: GlobalTable,
    fn: (tx: GlobalClient) => Promise<T>,
    options: ScopedTransactionOptions = {},
  ): Promise<T> {
    if (!GLOBAL_TABLES.has(table)) {
      throw new ScopeError(`${JSON.stringify(table)} is not a global table`);
    }
    return this.client.$transaction(
      async (tx) => fn(tx as unknown as GlobalClient),
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
    // Cross-household work still has to be attributable, so it runs inside an audit unit
    // with no household of its own. The rows it produces carry `household_id = NULL`,
    // which only the BYPASSRLS dispatcher role can insert — exactly the role this method
    // already documents as its precondition.
    return withAuditUnit(null, undefined, (flush) =>
      this.client.$transaction(
        async (tx) => {
          const result = await fn(tx as unknown as DispatcherClient);
          await flush(tx as unknown as AuditWriter);
          return result;
        },
        {
          timeout: options.timeoutMs ?? 30_000,
          maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
        },
      ),
    );
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
