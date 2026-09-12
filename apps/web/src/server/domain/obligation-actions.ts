import { ObligationStatusPatchSchema } from "@autobureau/contracts";
import { canonicalize } from "@autobureau/contracts/node";
import { outbox, Prisma, recordAudit } from "@autobureau/db";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import type { HandlerInput } from "@/server/http/route";
import { detailId, readObligation } from "./read";

export async function updateObligationStatus({ request, ctx, db }: HandlerInput) {
  const id = detailId(request);
  const body = await jsonBody(request, ObligationStatusPatchSchema);
  const closed = body.status === "done" || body.status === "dismissed";
  const verb = body.status === "done" ? "obligation.completed" : body.status === "dismissed" ? "obligation.dismissed" : "obligation.status_changed";
  return db.withHousehold(ctx.householdId, async (tx) => {
    // One lifecycle decision at a time, including two tabs completing the same row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`obligation:${ctx.householdId}:${id}`}, 0))`;
    const row = await tx.obligation.findUnique({ where: { id, householdId: ctx.householdId } });
    if (!row) throw new HttpProblem("not-found", "That record was not found.");
    const now = new Date();
    if (row.status === "dismissed" && body.status !== "dismissed" && now.getTime() - row.updatedAt.getTime() > 30 * 86_400_000) {
      throw new HttpProblem("conflict", "The 30-day restore window has ended.");
    }
    // Reopening clears the current completion outcome; the audit/event history remains.
    const outcome = body.status === "done" ? body.outcome ?? row.outcome : null;
    if (row.status === body.status && canonicalize(outcome) === canonicalize(row.outcome)) {
      return readObligation(tx, id, ctx.householdId, ctx.userId);
    }
    await tx.obligation.update({ where: { id, householdId: ctx.householdId }, data: {
      status: body.status, outcome: outcome === null ? Prisma.DbNull : outcome,
    } });
    if (!closed && (row.status === "done" || row.status === "dismissed")) {
      await recordAudit(tx, "obligation.reopened", { type: "obligation", id });
    }
    if (closed) {
      const reminders = await tx.reminder.findMany({ where: { householdId: ctx.householdId, obligationId: id, status: "scheduled" }, select: { id: true } });
      for (const reminder of reminders) await tx.reminder.update({ where: { id: reminder.id }, data: { status: "cancelled" } });
    }
    await outbox(tx).emit({ event_type: body.status === "done" ? "obligation.completed" : body.status === "dismissed" ? "obligation.dismissed" : "obligation.updated",
      aggregate_type: "obligation", aggregate_id: id, household_id: ctx.householdId,
      payload: { status: body.status, previous_status: row.status } });
    return readObligation(tx, id, ctx.householdId, ctx.userId);
  }, { verb });
}
