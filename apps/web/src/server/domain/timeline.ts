import { z } from "zod";
import { Prisma } from "@autobureau/db";
import { IsoDateTimeSchema, TimelineEntrySchema, TimelineLensSchema, type TimelineEntry } from "@autobureau/contracts";
import type { HandlerInput } from "@/server/http/route";
import { listQuery, pageOf } from "@/server/http/list";
import { HttpProblem } from "@/server/http/problem";

// Whitelisted lifecycle rows only: transaction-level verbs also stamp reminders and
// outbox rows, which must not turn one user action into several timeline entries.
const actions = [
  { target: "document", action: "document.create", lens: "documents", kind: "document_added", title: "Document added" },
  { target: "item", action: "item.create", lens: "items", kind: "item_added", title: "Record added" },
  { target: "item", action: "item.update", lens: "items", kind: "item_changed", title: "Record updated" },
  { target: "obligation", action: "obligation.create", lens: "obligations", kind: "obligation_created", title: "Deadline added" },
  { target: "obligation", action: "obligation.completed", lens: "obligations", kind: "obligation_completed", title: "Deadline completed" },
  { target: "obligation", action: "obligation.dismissed", lens: "obligations", kind: "obligation_dismissed", title: "Deadline dismissed" },
  // A reopen also emits an explicit audit marker. Its one canonical lifecycle row
  // is status_changed; do not display both or infer old field values from today's row.
  { target: "obligation", action: "obligation.status_changed", lens: "obligations", kind: "obligation_status_changed", title: "Deadline status changed" },
] as const;
const filters = z.object({ lens: TimelineLensSchema.default("all") }).strict();
const cursor = z.tuple([IsoDateTimeSchema, z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)]);
type Row = { id: string; at: string; action: string; targetType: string; targetId: string | null };

export async function timeline({ request, ctx, db }: HandlerInput) {
  const query = listQuery(new URL(request.url), { resource: `timeline:${ctx.householdId}`, filters, sort: "created_at.desc,id.desc" });
  const after = query.after ? cursor.safeParse(query.after) : null;
  if (after && !after.success) throw new HttpProblem("validation", "This page cursor is invalid.");
  const selected = actions.filter((entry) => query.filters.lens === "all" || entry.lens === query.filters.lens);
  return db.withHousehold(ctx.householdId, async (tx) => {
    // Keep all six timestamp fractional digits in the keyset. JS Date truncates to
    // milliseconds and would skip audit rows sharing a transaction timestamp.
    // No audit metadata, actor identifiers, raw attrs or outcome notes leave this API.
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT id::text, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
        action, target_type AS "targetType", target_id AS "targetId"
      FROM public.audit_log
      WHERE household_id = ${ctx.householdId}::uuid
        AND (${Prisma.join(selected.map((entry) => Prisma.sql`(target_type = ${entry.target} AND action = ${entry.action})`), " OR ")})
        ${after?.success ? Prisma.sql`AND (created_at, id) < (${after.data[0]}::timestamptz, ${after.data[1]}::bigint)` : Prisma.empty}
      ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}
    `);
    const page = pageOf(rows, query, (row) => [row.at, row.id]);
    const ids = (type: string) => [...new Set(page.data.flatMap((row) => row.targetType === type && row.targetId ? [row.targetId] : []))];
    // Audit targets have no foreign key. Resolve through the tenant boundary even
    // if a corrupt/legacy row points at another household's record.
    const documents = await tx.document.findMany({ where: { householdId: ctx.householdId, id: { in: ids("document") } }, select: { id: true, title: true } });
    const items = await tx.item.findMany({ where: { householdId: ctx.householdId, id: { in: ids("item") } }, select: { id: true, name: true } });
    const obligations = await tx.obligation.findMany({ where: { householdId: ctx.householdId, id: { in: ids("obligation") } }, select: { id: true, title: true } });
    const names = new Map([...documents.map((row) => [row.id, row.title ?? "Untitled document"] as const),
      ...items.map((row) => [row.id, row.name] as const), ...obligations.map((row) => [row.id, row.title] as const)]);
    return { ...page, data: page.data.map((row): TimelineEntry => {
      const definition = selected.find((entry) => entry.target === row.targetType && entry.action === row.action)!;
      const name = row.targetId ? names.get(row.targetId) : undefined;
      return TimelineEntrySchema.parse({ id: row.id, at: row.at, kind: definition.kind, title: definition.title,
        detail: name === undefined ? "The original record is no longer available." : `Current record: ${name}`,
        ...(name !== undefined && row.targetType === "obligation" ? { href: `/obligations/${row.targetId}` } : {}),
      });
    }) };
  });
}
