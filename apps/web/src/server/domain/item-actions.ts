import { ItemCreateSchema, ItemPatchSchema, uuidv7 } from "@autobureau/contracts";
import { outbox, type ScopedClient } from "@autobureau/db";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import { created, type HandlerInput } from "@/server/http/route";
import { detailId, readItem } from "./read";

async function activeMember(tx: ScopedClient, householdId: string, memberId: string | null) {
  if (!memberId) return;
  // Serialize association with member archive, so a newly linked record cannot
  // race an archive and appear to have been assigned to an active person.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${householdId}`}, 0))`;
  if (!await tx.householdMember.findFirst({ where: { id: memberId, householdId, archivedAt: null }, select: { id: true } })) {
    throw new HttpProblem("not-found", "That active person was not found.");
  }
}
export async function createItem({ request, ctx, db }: HandlerInput) {
  const body = await jsonBody(request, ItemCreateSchema);
  return db.withHousehold(ctx.householdId, async (tx) => {
    await activeMember(tx, ctx.householdId, body.member_id);
    const id = uuidv7();
    await tx.item.create({ data: { id, householdId: ctx.householdId, name: body.name, kind: body.kind,
      memberId: body.member_id, vendorName: body.vendor_name, amountCents: body.amount_cents, currency: body.currency,
      billingCycle: body.billing_cycle, validFrom: body.valid_from ? new Date(body.valid_from) : null,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null, createdAt: new Date(),
    } });
    await outbox(tx).emit({ event_type: "item.created", aggregate_type: "item", aggregate_id: id,
      household_id: ctx.householdId, payload: { source: "user", kind: body.kind } });
    return created(await readItem(tx, id, ctx.householdId), `/v1/items/${id}`);
  });
}
export async function editItem({ request, ctx, db }: HandlerInput) {
  const id = detailId(request), patch = await jsonBody(request, ItemPatchSchema);
  return db.withHousehold(ctx.householdId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`item:${ctx.householdId}:${id}`}, 0))`;
    const row = await readItem(tx, id, ctx.householdId);
    const before = { name: row.name, kind: row.kind, member_id: row.member_id, vendor_name: row.vendor_name,
      amount_cents: row.amount_cents, currency: row.currency, billing_cycle: row.billing_cycle,
      valid_from: row.valid_from, expires_at: row.expires_at };
    if (Object.entries(patch).every(([key, value]) => before[key as keyof typeof before] === value)) return row;
    // Validate coupled fields after merging. A PATCH clearing just the amount must
    // not leave an orphaned currency; an expiry edit must still respect the start.
    const parsed = ItemCreateSchema.safeParse({ ...before, ...patch });
    if (!parsed.success) throw new HttpProblem("validation", "These record details do not fit together.", parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    const body = parsed.data;
    if (body.member_id !== row.member_id) await activeMember(tx, ctx.householdId, body.member_id);
    await tx.item.update({ where: { id, householdId: ctx.householdId }, data: {
      name: body.name, kind: body.kind, memberId: body.member_id, vendorName: body.vendor_name,
      amountCents: body.amount_cents, currency: body.currency, billingCycle: body.billing_cycle,
      validFrom: body.valid_from ? new Date(body.valid_from) : null, expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      verifiedAt: null,
    } });
    await outbox(tx).emit({ event_type: "item.updated", aggregate_type: "item", aggregate_id: id,
      household_id: ctx.householdId, payload: { source: "user" } });
    return readItem(tx, id, ctx.householdId);
  });
}
