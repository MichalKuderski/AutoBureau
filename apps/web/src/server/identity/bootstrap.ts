import { createHash } from "node:crypto";
import { runAsUser, type Database, type ScopedClient } from "@autobureau/db";

/**
 * First-household bootstrap (blueprint P1-02).
 *
 * Mirroring (ADR-009 D8) puts a principal's `users` row in this database. That is not
 * enough to admit them: `resolveRequestContext` counts memberships, finds none, and
 * raises `no-membership` — a 403 on every request, including the `(app)` layout, whose
 * own comment records why it does not reroute ("would send someone to a screen that
 * cannot create a household anyway"). Nothing in this repository created a `households`
 * row outside a test. This is the step that does.
 *
 * WHERE IT RUNS
 * -------------
 * Immediately after `mirrorIdentity`, at the two places a session is established —
 * `/v1/auth/sign-in` and `/auth/callback` — and before the cookies are issued. The
 * sign-in route already states the principle this follows: "a session whose identity is
 * not in this database is a session that resolves to 403 on every request; issuing one
 * would be creating a partially usable identity". A session whose *household* is missing
 * is partially usable in exactly the same way, so it is completed in the same place.
 *
 * WHY NOT A `POST /v1/households`
 * -------------------------------
 * The blueprint suggests one, and it cannot work as a first-user path: `authenticated()`
 * resolves a `RequestContext` before the handler runs, and that resolution is precisely
 * what fails with `no-membership` for the user who needs the endpoint. Serving it would
 * mean a second, bespoke authentication path outside the `/v1` chokepoint — CSRF and
 * token verification reimplemented next to the one place they are already correct. The
 * browser also stops being able to ask for household ownership at all, which is the
 * stronger property: ownership is never something a client requests.
 *
 * WHAT IT TRUSTS
 * --------------
 * The verified subject, and nothing else. No request body, header, or query reaches this
 * function; the household id is derived, the role is fixed, and the entitlement is the
 * schema's own defaults.
 */

/**
 * Namespace for the derived id. Changing this string re-points every future bootstrap at
 * a different household id and must never be done casually — see the convergence note.
 */
const NAMESPACE = "autobureau.household.bootstrap.v1";

/** The role the first member of a household holds. `HouseholdRole.owner`, not a new one. */
const FIRST_MEMBER_ROLE = "owner" as const;

/**
 * Placeholder, and deliberately not derived from the principal.
 *
 * Nothing in the product asks what a household is called: onboarding collects members and
 * document types, never a name. `user_profiles.display_name` faced the same gap at mirror
 * time and was filled with the verified address because that was "the only value the
 * system actually knows" — but a household is not a person, and the address is the wrong
 * noun for it. Settings already offers a rename, so the honest default is one that claims
 * nothing and leaks no address into a column future household members can read.
 */
const PLACEHOLDER_NAME = "Your household";

export interface BootstrapResult {
  readonly householdId: string;
  /** True when this call created the household rather than finding one already there. */
  readonly created: boolean;
}

/**
 * The bootstrap household's id, derived from the principal.
 *
 * THIS IS THE CONCURRENCY DESIGN, AND IT IS THE WHOLE REASON THE ID IS NOT RANDOM.
 *
 * Two simultaneous first sign-ins cannot be serialised by reading first: the membership
 * read and the creating write must run in different database scopes — phase 1 sets
 * `request.user_id` with no household so the self-read policies apply, while inserting a
 * `households` row requires `request.household_id` to already equal that row's id (see
 * the RLS migration's `WITH CHECK (id = app.current_household())`). Two scopes means two
 * transactions, and a check-then-create across two transactions always races.
 *
 * A transaction-scoped advisory lock cannot span them either, and a session-scoped one on
 * a pooled connection is the same class of bug the tenancy GUC exists to avoid.
 *
 * So convergence has to be a database invariant. Deriving the id from the principal makes
 * it the one already there: both racers compute the *same* id, both attempt
 * `INSERT INTO households (id) …`, and the primary key admits exactly one. The loser's
 * transaction aborts whole — no household, no membership, no entitlement, no audit row —
 * and re-reads to find the winner's household.
 *
 * The considered alternative was `UNIQUE (households.created_by)`, which needs a migration
 * and asserts that a principal may never create a second household. Nothing in the PRD or
 * the architecture settles that — P1-03 says the caregiver persona has two households
 * without saying whether they created both — so the constraint would have been a product
 * decision smuggled in as an index.
 *
 * Predictability costs nothing here: household ids are not secrets. They travel in
 * `X-Household-Id` and are useless without a membership row, which both
 * `resolveRequestContext` and RLS check independently.
 */
export function bootstrapHouseholdId(userId: string): string {
  const digest = createHash("sha256").update(`${NAMESPACE}:${userId}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  // Version 8 — RFC 9562's "custom" form, which is what a derived id honestly is — and
  // the RFC variant. Both nibbles matter: `scoped.ts` validates the shape before it will
  // open a scope with this value.
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Prisma's unique-violation code, matched structurally so no client type is imported here. */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === "P2002"
  );
}

/** Phase 1: the principal's own memberships, the same read `resolveRequestContext` does. */
function existingMembership(db: Database, userId: string): Promise<string | null> {
  return db.withPrincipal(userId, async (tx: ScopedClient) => {
    const rows = await tx.householdUser.findMany({
      where: { userId },
      select: { householdId: true },
      orderBy: { createdAt: "asc" },
    });
    return rows[0]?.householdId ?? null;
  });
}

/**
 * Ensure the principal belongs to a household, creating their first one if not.
 *
 * Idempotent by construction: a principal who already belongs to any household — their
 * own or one they were invited to — gets that household back and nothing is written. This
 * is deliberately *membership*, not ownership: someone invited to a household before they
 * ever signed in should join it rather than be handed a second, empty one of their own.
 */
export async function ensureHousehold(
  db: Database,
  userId: string,
): Promise<BootstrapResult> {
  const already = await existingMembership(db, userId);
  if (already !== null) return { householdId: already, created: false };

  const householdId = bootstrapHouseholdId(userId);

  try {
    await runAsUser(userId, () =>
      // One transaction, so the three rows commit together or not at all. `withHousehold`
      // also flushes the audit rows inside it, which is why a rolled-back bootstrap
      // leaves no trace of itself either.
      db.withHousehold(householdId, async (tx: ScopedClient) => {
        // THE HOUSEHOLD ROW GOES FIRST, AND THE ORDER IS A SECURITY PROPERTY.
        // `withHousehold` will happily scope to an id that already exists, and the
        // membership insert's `WITH CHECK (household_id = app.current_household())` would
        // pass inside that scope — so a bootstrap that attached membership before proving
        // the household is new would be a way to join an arbitrary household. Inserting
        // the household first means the primary key refuses that case and the transaction
        // is already dead before any membership is written.
        await tx.household.create({
          data: { id: householdId, name: PLACEHOLDER_NAME, createdBy: userId },
        });
        await tx.householdUser.create({
          data: { householdId, userId, role: FIRST_MEMBER_ROLE },
        });
        // Defaults come from the schema (free, 10 docs/month, 2 members). `periodStart`
        // has none and is the only value supplied: today, as a date.
        await tx.entitlement.create({
          data: { householdId, periodStart: new Date() },
        });
      }),
    );
    return { householdId, created: true };
  } catch (cause) {
    if (!isUniqueViolation(cause)) throw cause;

    // Lost the race. Postgres held this insert until the winner committed, so the
    // winner's rows are visible now — read them through the same phase-1 path rather
    // than assuming the derived id, so what is returned is a membership that exists.
    const converged = await existingMembership(db, userId);
    if (converged === null) {
      // The unique violation was not the one this function is designed around. Failing
      // loudly beats returning a household id whose membership was never proved.
      throw cause;
    }
    return { householdId: converged, created: false };
  }
}
