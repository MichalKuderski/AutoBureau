import { HouseholdRoleSchema } from "@autobureau/contracts";

/**
 * Centralized authorization (doc 06 §3, ADR-009 D5).
 *
 * "Enforcement is centralized: a `can(ctx, action, resource)` policy module — handlers
 * call it; policy logic never lives inline in handlers." This is that module, and the
 * matrix below is doc 06 §3's table transcribed, not reinterpreted.
 *
 * WHAT THIS LAYER IS AND IS NOT
 * ----------------------------
 * RLS carries a household in its transaction-local setting and nothing else — no
 * principal, no role. It therefore enforces *tenancy* and only tenancy. Every role rule
 * is application-layer, and this is the only place one lives. The converse also holds:
 * this module does not re-implement tenancy, because `withHousehold` plus the policies
 * already do it twice.
 *
 * The household check below is the exception that proves it. It is not a tenancy
 * mechanism — RLS would refuse the row anyway — it is a guard against asking the
 * question about the wrong household in the first place, which turns a silent empty
 * result into a loud denial.
 *
 * Two rows of doc 06 §3 are deliberately absent: "start task runs" and "approve external
 * actions" both belong to the agent/approval subsystem, which PRD §9 postpones to v2.
 * Adding them here would imply a capability the product does not have.
 */

export type HouseholdRole = (typeof HouseholdRoleSchema)["options"][number];

/** One entry per capability row of doc 06 §3 that exists in v1. */
export const CAPABILITIES = {
  /** Read registry / documents / obligations. */
  "registry.read": ["owner", "member", "viewer"],
  "document.upload": ["owner", "member"],
  "document.review": ["owner", "member"],
  "item.write": ["owner", "member"],
  "obligation.write": ["owner", "member"],
  /** Reveal a full identifier-grade value. Always audited (doc 12 §5.3). */
  "secret.reveal": ["owner", "member"],
  "member.manage": ["owner"],
  /** Email alias, notification defaults. */
  "settings.manage": ["owner"],
  "household.delete": ["owner"],
  "household.export": ["owner"],
} as const satisfies Record<string, readonly HouseholdRole[]>;

export type Capability = keyof typeof CAPABILITIES;

/** The authorization inputs. Structurally the `RequestContext` the resolver returns. */
export interface PolicySubject {
  readonly userId: string;
  readonly householdId: string;
  readonly role: HouseholdRole;
}

/**
 * The thing being acted upon. Only its household matters at this layer — everything
 * finer is the database's job, and duplicating row-level rules here would create two
 * sources of truth for the same question.
 */
export interface PolicyResource {
  readonly householdId: string;
}

/**
 * Fail-closed by construction: every path that is not an explicit allow returns false.
 * An unknown capability, an unknown role, or a resource from another household all deny.
 */
export function can(
  subject: PolicySubject,
  capability: Capability,
  resource?: PolicyResource,
): boolean {
  const allowed: readonly HouseholdRole[] | undefined = CAPABILITIES[capability];
  if (allowed === undefined) return false;

  // A role the enum does not contain cannot be in any row, but check explicitly so a
  // widened enum fails closed rather than silently inheriting someone else's row.
  if (!HouseholdRoleSchema.safeParse(subject.role).success) return false;

  if (resource !== undefined && resource.householdId !== subject.householdId) return false;

  return allowed.includes(subject.role);
}

/** `can`, as an assertion. Handlers that cannot proceed on a denial use this. */
export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(readonly capability: Capability) {
    super(`this role may not ${capability}`);
  }
}

export function assertCan(
  subject: PolicySubject,
  capability: Capability,
  resource?: PolicyResource,
): void {
  if (!can(subject, capability, resource)) throw new ForbiddenError(capability);
}
