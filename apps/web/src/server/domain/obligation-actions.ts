import { ObligationCreateSchema, ObligationMutationSchema, type ObligationDetailsPatch, uuidv7 } from "@autobureau/contracts";
import { Temporal } from "@js-temporal/polyfill";
import { canonicalize } from "@autobureau/contracts/node";
import { outbox, Prisma, recordAudit } from "@autobureau/db";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import { created, type HandlerInput } from "@/server/http/route";
import { detailId, readObligation } from "./read";

export async function createObligation({ request, ctx, db }: HandlerInput) {
  const body = await jsonBody(request, ObligationCreateSchema);
  let dueAt: Date;
  try { dueAt = new Date(Temporal.Instant.from(body.due_at).epochMilliseconds); }
  catch { throw new HttpProblem("validation", "Enter a valid deadline date and time with its UTC offset."); }
  return db.withHousehold(ctx.householdId, async (tx) => {
    // Match record/member mutation lock order before validating live associations.
    if (body.item_id) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`item:${ctx.householdId}:${body.item_id}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${ctx.householdId}`}, 0))`;
    if (body.member_id && !await tx.householdMember.findFirst({ where: { id: body.member_id, householdId: ctx.householdId, archivedAt: null }, select: { id: true } })) {
      throw new HttpProblem("not-found", "That active person was not found.");
    }
    if (body.item_id && !await tx.item.findFirst({ where: { id: body.item_id, householdId: ctx.householdId, status: { not: "archived" } }, select: { id: true } })) {
      throw new HttpProblem("not-found", "That active record was not found.");
    }
    const id = uuidv7(), now = new Date();
    await tx.obligation.create({ data: { id, householdId: ctx.householdId, title: body.title, kind: body.kind,
      direction: body.direction, priority: body.priority, memberId: body.member_id, itemId: body.item_id,
      dueAt, amountCents: body.amount_cents, currency: body.currency, source: "user", verifiedAt: now,
      status: dueAt.getTime() <= now.getTime() + 7 * 86_400_000 ? "action_needed" : "upcoming", createdAt: now,
    } });
    await outbox(tx).emit({ event_type: "obligation.created", aggregate_type: "obligation", aggregate_id: id,
      household_id: ctx.householdId, payload: { source: "user", kind: body.kind } });
    return created(await readObligation(tx, id, ctx.householdId, ctx.userId), `/v1/obligations/${id}`);
  });
}

export async function updateObligation({ request, ctx, db }: HandlerInput) {
  const id = detailId(request);
  const body = await jsonBody(request, ObligationMutationSchema);
  if (!("status" in body)) return editDetails({ request, ctx, db }, id, body);
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

async function editDetails({ ctx, db }: HandlerInput, id: string, patch: ObligationDetailsPatch) {
  return db.withHousehold(ctx.householdId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`obligation:${ctx.householdId}:${id}`}, 0))`;
    const row = await readObligation(tx, id, ctx.householdId, ctx.userId);
    const before = { title: row.title, kind: row.kind, direction: row.direction, priority: row.priority,
      due_at: row.due_at, item_id: row.item_id, member_id: row.member_id, amount_cents: row.amount_cents, currency: row.currency };
    const parsed = ObligationCreateSchema.safeParse({ ...before, ...patch });
    if (!parsed.success) throw new HttpProblem("validation", "These deadline details do not fit together.");
    const body = parsed.data;
    try { body.due_at = new Date(Temporal.Instant.from(body.due_at).epochMilliseconds).toISOString(); }
    catch { throw new HttpProblem("validation", "Enter a valid deadline date and time."); }
    if (canonicalize(before) === canonicalize(body)) return row;
    if (body.item_id !== row.item_id && body.item_id) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`item:${ctx.householdId}:${body.item_id}`}, 0))`;
      if (!await tx.item.findFirst({ where: { id: body.item_id, householdId: ctx.householdId, status: { not: "archived" } }, select: { id: true } })) throw new HttpProblem("not-found", "That active record was not found.");
    }
    if (body.member_id !== row.member_id && body.member_id) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${ctx.householdId}`}, 0))`;
      if (!await tx.householdMember.findFirst({ where: { id: body.member_id, householdId: ctx.householdId, archivedAt: null }, select: { id: true } })) throw new HttpProblem("not-found", "That active person was not found.");
    }
    const dueChanged = body.due_at !== row.due_at, now = new Date(), dueAt = new Date(body.due_at);
    const status = dueChanged && ["upcoming", "action_needed", "missed"].includes(row.status)
      ? dueAt.getTime() <= now.getTime() + 7 * 86_400_000 ? "action_needed" : "upcoming" : row.status;
    await tx.obligation.update({ where: { id, householdId: ctx.householdId }, data: {
      title: body.title, kind: body.kind, direction: body.direction, priority: body.priority, dueAt,
      memberId: body.member_id, itemId: body.item_id, amountCents: body.amount_cents, currency: body.currency,
      // Keep the original document association as history; the edited facts are
      // explicitly user-confirmed and carry no inherited AI confidence.
      source: "user", aiConfidence: null, verifiedAt: now, status,
    } });
    if (dueChanged) {
      const reminders = await tx.reminder.findMany({ where: { householdId: ctx.householdId, obligationId: id, status: "scheduled" }, select: { id: true } });
      for (const reminder of reminders) await tx.reminder.update({ where: { id: reminder.id }, data: { status: "cancelled" } });
    }
    await outbox(tx).emit({ event_type: "obligation.updated", aggregate_type: "obligation", aggregate_id: id,
      household_id: ctx.householdId, payload: { source: "user", due_changed: dueChanged } });
    return readObligation(tx, id, ctx.householdId, ctx.userId);
  }, { verb: "obligation.details_changed" });
}
