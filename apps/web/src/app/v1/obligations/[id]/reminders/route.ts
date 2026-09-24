import { UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

/** Planned reminders for one obligation and whether delivery is active. Nothing creates or
 * sends reminders in this build, so `deliveryActive` is false and the UI must say so. */
export const GET = authenticated({ requires: "registry.read" }, async ({ request, ctx, db }) => {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-2));
  if (!id.success) throw new HttpProblem("not-found", "That deadline was not found.");
  return db.withHousehold(ctx.householdId, async tx => {
    const obligation = await tx.obligation.findFirst({ where: { id: id.data, householdId: ctx.householdId }, select: { id: true } });
    if (!obligation) throw new HttpProblem("not-found", "That deadline was not found.");
    const rows = await tx.reminder.findMany({ where: { obligationId: id.data, householdId: ctx.householdId },
      orderBy: [{ remindAt: "asc" }, { id: "asc" }], take: 20, select: { remindAt: true, offsetLabel: true, status: true, sentAt: true } });
    return { deliveryActive: false as const, reminders: rows.map(r => ({ remindAt: r.remindAt.toISOString(), offsetLabel: r.offsetLabel, status: r.status, sentAt: r.sentAt?.toISOString() ?? null })) };
  });
});
export const dynamic = "force-dynamic";
