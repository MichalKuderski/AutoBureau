import { HouseholdPatchSchema, HouseholdSchema, UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

export const PATCH = authenticated({ requires: "settings.manage" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-1));
  if (!id.success || id.data !== ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  const patch = await jsonBody(request, HouseholdPatchSchema);
  return db.withHousehold(ctx.householdId, async (tx) => {
    const row = await tx.household.findUnique({ where: { id: ctx.householdId } });
    if (!row) throw new HttpProblem("not-found", "That household was not found.");
    const saved = patch.name !== undefined && patch.name !== row.name
      ? await tx.household.update({ where: { id: row.id }, data: { name: patch.name } }) : row;
    return HouseholdSchema.parse({ id: saved.id, name: saved.name, email_alias: saved.emailAlias, created_at: saved.createdAt.toISOString() });
  }, { verb: "household.settings_changed" });
});
export const dynamic = "force-dynamic";
