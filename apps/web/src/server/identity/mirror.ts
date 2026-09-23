import type { Database } from "@autobureau/db";
import { runAsUser } from "@autobureau/db";
import type { VerifiedPrincipal } from "../auth/jwt";

/**
 * Identity mirroring (ADR-009 D8).
 *
 * A Supabase-authenticated principal has no rows in this database until this runs.
 * `household_users.user_id` is a foreign key to `users.id`, so without a mirrored row a
 * person can hold a perfectly valid session and resolve to 403 on every request.
 *
 * WHERE THIS RUNS, AND WHY NOT EVERYWHERE
 * ---------------------------------------
 * Once, when a session is established — sign-in and callback — rather than on every
 * request. Mirroring per request would add a query to the hot path to re-answer a
 * question that changes once in an account's lifetime. Every session in this system is
 * created by one of those two routes, so covering them covers every principal.
 *
 * WHAT IT TRUSTS
 * --------------
 * Only claims from a token this process verified: the subject, and the email. Nothing
 * from request input reaches this function, and `actor_id` on the resulting audit row is
 * stamped by the database from the principal setting rather than by anything passed here.
 *
 * CONCURRENCY
 * -----------
 * Two simultaneous first logins race. Rather than a lock, the writes lean on constraints
 * that already exist — `users.id` is the primary key, `user_profiles.user_id` is the
 * primary key — through `createMany({ skipDuplicates: true })`, which compiles to
 * `INSERT … ON CONFLICT DO NOTHING`. The loser of the race inserts zero rows and both
 * requests observe one consistent identity. An application-level mutex would be a
 * second, weaker copy of a guarantee Postgres already gives.
 */

export class MirrorError extends Error {
  override readonly name = "MirrorError";
  constructor(
    readonly reason: "no-email" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface MirrorResult {
  /** True when this call created the identity rather than finding it already there. */
  readonly created: boolean;
}

export async function mirrorIdentity(
  db: Database,
  principal: VerifiedPrincipal,
): Promise<MirrorResult> {
  if (principal.email === undefined) {
    // Fail closed rather than invent an address for a NOT NULL column. A provider that
    // issues tokens without an email claim is misconfigured for this product, and
    // discovering that at sign-in is better than discovering it as a broken row.
    throw new MirrorError("no-email", "the verified token carries no email claim");
  }
  const email = principal.email;

  return runAsUser(principal.userId, () =>
    db.withIdentity(principal.userId, async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: principal.userId },
        select: { id: true },
      });
      // The common path — every login after the first — writes nothing and therefore
      // audits nothing. An audit row per sign-in would be noise, not a record.
      if (existing) return { created: false };

      await tx.user.createMany({ data: [{ id: principal.userId, email }], skipDuplicates: true });
      await tx.userProfile.createMany({
        // `display_name` is NOT NULL with no default and no frozen guidance on what a
        // mirrored profile is called. The verified address is the only value the system
        // actually knows at this moment; onboarding and profile settings replace it.
        data: [{ userId: principal.userId, displayName: email }],
        skipDuplicates: true,
      });
      return { created: true };
    }),
  );
}
