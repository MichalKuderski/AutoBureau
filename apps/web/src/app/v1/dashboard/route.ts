import { DashboardSummarySchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { setupCoverage } from "@/server/domain/onboarding";

export const GET = authenticated({ requires: "registry.read" }, async ({ ctx, db }) => {
  const now = new Date();
  return db.withHousehold(ctx.householdId, async (tx) => {
    const [action, upcoming, review, items, verified] = await Promise.all([
      tx.obligation.count({ where: { status: "action_needed" } }),
      tx.obligation.count({ where: { status: { notIn: ["done", "dismissed", "missed"] }, dueAt: { gte: now, lt: new Date(now.getTime() + 30 * 86_400_000) } } }),
      tx.document.count({ where: { status: "needs_review" } }),
      tx.item.count({ where: { status: { not: "archived" } } }),
      tx.item.count({ where: { status: { not: "archived" }, verifiedAt: { not: null } } }),
    ]);
    return DashboardSummarySchema.parse({ action_needed: action, upcoming_30d: upcoming,
      needs_review: review, items_tracked: items,
      // No persisted recovery receipt or digest schedule exists yet.
      // Unknown values are null; estimated obligations are not money already recovered.
      value_found_cents: null, coverage: await setupCoverage(tx, ctx.householdId, ctx.userId, verified), next_digest_at: null });
  });
});
export const dynamic = "force-dynamic";
