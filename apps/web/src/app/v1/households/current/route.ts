import { authenticated } from "@/server/http/route";

/**
 * `GET /v1/households/current` — the household this request resolved to.
 *
 * The representative endpoint for F1. It was chosen because it exercises the entire
 * boundary — token, membership, capability, tenant scope, RLS — while needing no wire
 * contract that does not exist yet. Every richer endpoint in doc 03 §2 returns a view
 * model (`member_name`, `days_until`, provenance) whose schema is still unwritten, and
 * inventing one here to have something to return would be Phase 2D work smuggled into F1.
 *
 * The read runs inside `withHousehold`, so RLS is what actually scopes it: the query
 * asks for "the household" with no identifier, and the policy decides which row that is.
 * A boundary bug that resolved the wrong household would therefore return that
 * household's name, which is exactly the failure the HTTP tests assert against.
 */
export const GET = authenticated({ requires: "registry.read" }, async ({ ctx, db }) => {
  const household = await db.withHousehold(ctx.householdId, (tx) =>
    tx.household.findFirst({ select: { id: true, name: true } }),
  );

  return {
    id: household?.id ?? ctx.householdId,
    name: household?.name ?? null,
    role: ctx.role,
  };
});

/** Household data is per-principal; nothing here may be cached or statically rendered. */
export const dynamic = "force-dynamic";
