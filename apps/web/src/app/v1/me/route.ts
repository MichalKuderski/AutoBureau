import { ProfilePatchSchema, ProfileViewSchema } from "@autobureau/contracts";
import { authenticated, type HandlerInput } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

async function profile({ request, ctx, db }: HandlerInput) {
  const patch = request.method === "PATCH" ? await jsonBody(request, ProfilePatchSchema) : {};
  return db.withHousehold(ctx.householdId, async (tx) => {
    // Profiles are not tenant tables. The verified principal is the only permitted key.
    const row = await tx.userProfile.findUnique({ where: { userId: ctx.userId }, include: { user: { select: { email: true } } } });
    if (!row) throw new HttpProblem("not-found", "Your profile was not found.");
    const changed = (patch.display_name !== undefined && patch.display_name !== row.displayName)
      || (patch.timezone !== undefined && patch.timezone !== row.timezone);
    const saved = changed ? await tx.userProfile.update({
      where: { userId: ctx.userId },
      data: {
        ...(patch.display_name === undefined ? {} : { displayName: patch.display_name }),
        ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
      },
    }) : row;
    return ProfileViewSchema.parse({ user_id: saved.userId, display_name: saved.displayName,
      email: row.user.email, timezone: saved.timezone, locale: saved.locale });
  });
}

export const GET = authenticated({}, profile);
export const PATCH = authenticated({}, profile);
export const dynamic = "force-dynamic";
