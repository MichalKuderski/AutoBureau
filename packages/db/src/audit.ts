import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { AuditActionSchema, type AuditAction } from "@autobureau/contracts";

/**
 * Audit infrastructure (ADR-009 D5 + D6).
 *
 * THE SPLIT, AND WHY IT IS NOT THE ONE DOC 01 §4.5 ORIGINALLY DESCRIBED
 * --------------------------------------------------------------------
 * That document says the audit row is written "via a Prisma client extension". In
 * Prisma 6 it cannot be: inside a `query` extension `this` is `{'0': …}` and
 * `getExtensionContext` exposes no model delegates, so the hook holds no handle on the
 * enclosing interactive transaction and cannot write anything at all. The work splits
 * across two pieces of infrastructure instead — neither of which is a handler author,
 * which is the property that sentence was protecting:
 *
 *   the extension OBSERVES and ENFORCES — it refuses a mutation with no actor in scope,
 *     refuses one that needs a domain verb and did not declare one, and records the row
 *     it intends to write;
 *   `withHousehold` PERSISTS — it owns the transaction, so it flushes those rows before
 *     commit. A caller cannot skip the flush, because it does not own the transaction.
 *
 * Actor identity is deliberately NOT taken from this module. The rows are written with
 * `actor_id` omitted and the database stamps it from the principal setting (D5), so a
 * bug in context propagation cannot forge an actor — it can only fail closed.
 */

/** Who is acting. Established once per request or per job, never per query. */
export type Actor =
  | { readonly type: "user"; readonly userId: string }
  | { readonly type: "system"; readonly reason: string };

export class AuditError extends Error {
  override name = "AuditError";
}

interface PendingAuditRow {
  householdId: string | null;
  actorType: "user" | "system";
  action: string;
  targetType: string;
  targetId: string | null;
}

/** One scoped unit of work: the transaction `withHousehold` is about to run. */
interface AuditUnit {
  readonly actor: Actor;
  readonly householdId: string | null;
  readonly verb: AuditAction | undefined;
  readonly pending: PendingAuditRow[];
}

const actorStore = new AsyncLocalStorage<Actor>();
const unitStore = new AsyncLocalStorage<AuditUnit>();

/**
 * Establish the acting user for everything that happens inside `fn`.
 *
 * Called once at the request boundary. Async context propagates through
 * `withHousehold`'s interactive transaction and into the extension hook, so no call site
 * in between has to carry the actor.
 */
export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return actorStore.run({ type: "user", userId }, fn);
}

/**
 * Establish a non-human actor: the dispatcher, the deletion cascade, a migration, a
 * test fixture. The reason is required for the same purpose it is on
 * `unsafeAcrossAllHouseholds` — an unexplained system mutation is not auditable.
 */
export function runAsSystem<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  if (!reason || reason.length < 8) {
    throw new AuditError("runAsSystem requires a documented reason");
  }
  return actorStore.run({ type: "system", reason }, fn);
}

export function currentActor(): Actor | undefined {
  return actorStore.getStore();
}

/**
 * Operations whose CRUD-derived action would be ambiguous, so a domain verb is
 * mandatory (D6 category 1: one `update` covers dismiss, complete and reopen).
 *
 * This lives here rather than in `packages/contracts` because it is keyed on Prisma
 * model names, which are a database concern; the *vocabulary* it enforces is the
 * contracts registry.
 */
const VERB_REQUIRED: ReadonlySet<string> = new Set([
  "Obligation.update",
  "Obligation.updateMany",
]);

const MUTATING_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Reading an id off a result without asserting a shape we do not control. */
function idOf(result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * The observing half. Applied to the client before any transaction opens, because a
 * `Prisma.TransactionClient` cannot be extended after the fact.
 */
export const auditExtension = Prisma.defineExtension({
  name: "autobureau-audit",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // The audit table itself must not re-enter the hook, and reads are not audited:
        // doc 02 §9 records mutations. `secret.revealed` is the deliberate exception and
        // goes through `recordAudit`, because no write-interceptor can observe a read.
        if (model === "AuditLog" || !MUTATING_OPERATIONS.has(operation)) {
          return query(args);
        }

        const unit = unitStore.getStore();
        if (!unit) {
          throw new AuditError(
            `${model}.${operation} ran outside a scoped unit of work — no actor to attribute it to`,
          );
        }
        if (VERB_REQUIRED.has(`${model}.${operation}`) && unit.verb === undefined) {
          throw new AuditError(
            `${model}.${operation} requires a domain verb; pass one as withHousehold's \`verb\` option`,
          );
        }

        const result = await query(args);
        unit.pending.push({
          householdId: unit.householdId,
          actorType: unit.actor.type,
          action: unit.verb ?? `${model.toLowerCase()}.${operation.toLowerCase()}`,
          targetType: model.toLowerCase(),
          targetId: idOf(result),
        });
        return result;
      },
    },
  },
});

/**
 * Runs `fn` inside an audit unit and flushes whatever it recorded, in the caller's
 * transaction. Exported for `Database` only — the flush is not something a handler
 * should be able to invoke, skip, or reorder.
 */
export async function withAuditUnit<T>(
  householdId: string | null,
  verb: AuditAction | undefined,
  fn: (flush: (tx: AuditWriter) => Promise<void>) => Promise<T>,
): Promise<T> {
  const actor = actorStore.getStore();
  if (!actor) {
    // Reads are unaffected — the extension only intercepts mutations — so this fires
    // only when someone tries to change data with nobody accountable for it.
    return fn(async () => {});
  }
  const unit: AuditUnit = { actor, householdId, verb, pending: [] };
  return unitStore.run(unit, () =>
    fn(async (tx) => {
      if (unit.pending.length > 0) await tx.auditLog.createMany({ data: unit.pending });
    }),
  );
}

/** The narrow slice of a transaction client the audit writer needs. */
export interface AuditWriter {
  auditLog: {
    createMany(args: { data: PendingAuditRow[] }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

/**
 * Record an action the extension cannot observe.
 *
 * The motivating case is `secret.revealed` (doc 12 §5.3): revealing an identifier-grade
 * value is a *read*, so no write-interceptor will ever see it, and PRD §13 requires it
 * audited anyway. Restricted to the registry — an arbitrary string is not an audit
 * trail, it is a log line.
 */
export async function recordAudit(
  tx: AuditWriter,
  action: AuditAction,
  target: { type: string; id?: string | null },
): Promise<void> {
  const parsed = AuditActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new AuditError(`${String(action)} is not a registered audit action`);
  }
  const unit = unitStore.getStore();
  if (!unit) {
    throw new AuditError(`recordAudit(${action}) ran outside a scoped unit of work`);
  }
  await tx.auditLog.create({
    data: {
      householdId: unit.householdId,
      actorType: unit.actor.type,
      action: parsed.data,
      targetType: target.type,
      targetId: target.id ?? null,
    },
  });
}
