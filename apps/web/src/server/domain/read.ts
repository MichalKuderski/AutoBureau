import { z } from "zod";
import type { Prisma, ScopedClient } from "@autobureau/db";
import {
  DocStatusSchema, DocTypeSchema, DocumentViewSchema, ItemKindSchema, ItemStatusSchema, ItemViewSchema,
  ObligationDirectionSchema, ObligationStatusSchema, ObligationViewSchema, UuidSchema, IsoDateTimeSchema,
  type ObligationView,
} from "@autobureau/contracts";
import { listQuery, pageOf, type ListQuery } from "@/server/http/list";
import { HttpProblem } from "@/server/http/problem";
import type { HandlerInput } from "@/server/http/route";
import { daysUntil } from "@/lib/format";

const q = z.string().trim().max(160).optional();
const member_id = UuidSchema.optional();
const multiStatus = z.preprocess((v) => typeof v === "string" ? [v] : v, z.array(ObligationStatusSchema).min(1).max(7).optional());
export const ItemFiltersSchema = z.object({ q, member_id, kind: ItemKindSchema.optional(), status: ItemStatusSchema.optional() }).strict();
export const DocumentFiltersSchema = z.object({ q, member_id, status: z.preprocess((v) => typeof v === "string" ? [v] : v, z.array(DocStatusSchema).min(1).max(10).optional()), doc_type: DocTypeSchema.optional() }).strict();
export const ObligationFiltersSchema = z.object({
  q, member_id, status: multiStatus, direction: ObligationDirectionSchema.optional(),
  due_before: IsoDateTimeSchema.optional(), due_after: IsoDateTimeSchema.optional(),
  due_within_days: z.coerce.number().int().min(0).max(366).optional(),
}).strict();

// Explicit projections keep ciphertext, arbitrary attrs/extraction JSON and storage paths
// out of the web representation. Relation queries execute in the same RLS transaction.
const ITEM_SELECT = {
  id: true, householdId: true, memberId: true, kind: true, name: true, status: true,
  vendorId: true, vendorName: true, amountCents: true, currency: true, billingCycle: true,
  validFrom: true, expiresAt: true, verifiedAt: true, sourceDocumentId: true, createdAt: true,
  member: { select: { displayName: true } },
  sourceDocument: { select: { id: true } },
  secrets: { select: { field: true, last4: true } },
  _count: { select: { obligations: { where: { status: { notIn: ["done", "dismissed"] } } } } },
} satisfies Prisma.ItemSelect;
const DOCUMENT_SELECT = {
  id: true, householdId: true, source: true, status: true, docType: true, confidence: true,
  title: true, docDate: true, mimeType: true, sizeBytes: true, createdAt: true, processedAt: true,
  items: { select: { id: true, member: { select: { displayName: true } } } },
} satisfies Prisma.DocumentSelect;
const OBLIGATION_SELECT = {
  id: true, householdId: true, itemId: true, memberId: true, title: true, kind: true, direction: true,
  status: true, priority: true, dueAt: true, windowStart: true, graceUntil: true, amountCents: true,
  currency: true, recurrence: true, source: true, sourceDocumentId: true, aiConfidence: true,
  outcome: true, verifiedAt: true,
  item: { select: { name: true } }, member: { select: { displayName: true } },
} satisfies Prisma.ObligationSelect;
type ItemRow = Prisma.ItemGetPayload<{ select: typeof ITEM_SELECT }>;
type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;
type ObligationRow = Prisma.ObligationGetPayload<{ select: typeof OBLIGATION_SELECT }>;

function integer(value: bigint | null): number | null {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Stored integer exceeds the wire range");
  return result;
}
const iso = (date: Date | null) => date?.toISOString() ?? null;
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

function itemView(row: ItemRow) {
  return ItemViewSchema.parse({
    id: row.id, household_id: row.householdId, member_id: row.memberId,
    kind: row.kind, name: row.name, status: row.status, vendor_id: row.vendorId, vendor_name: row.vendorName,
    amount_cents: integer(row.amountCents), currency: row.currency, billing_cycle: row.billingCycle,
    valid_from: day(row.validFrom), expires_at: day(row.expiresAt), verified_at: iso(row.verifiedAt),
    source_document_id: row.sourceDocument?.id ?? null, member_name: row.member?.displayName ?? null,
    open_obligation_count: row._count.obligations, document_count: row.sourceDocument ? 1 : 0, secrets: row.secrets,
  });
}
function documentView(row: DocumentRow) {
  const names = [...new Set(row.items.flatMap((item) => item.member ? [item.member.displayName] : []))];
  return DocumentViewSchema.parse({
    id: row.id, household_id: row.householdId, source: row.source, status: row.status,
    doc_type: row.docType && DocTypeSchema.safeParse(row.docType).success ? row.docType : null,
    confidence: row.confidence === null ? null : Number(row.confidence), title: row.title,
    doc_date: day(row.docDate), mime_type: row.mimeType, size_bytes: integer(row.sizeBytes),
    created_at: row.createdAt.toISOString(), processed_at: iso(row.processedAt),
    member_name: names.length === 1 ? names[0] : null, linked_item_ids: row.items.map((item) => item.id),
    // Never expose raw extracted/review JSON; the validated review pipeline owns proposals.
    proposed_changes: null,
  });
}

async function timezoneFor(tx: ScopedClient, userId: string) {
  const profile = await tx.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
  return profile?.timezone ?? "UTC";
}
async function obligationViews(tx: ScopedClient, rows: ObligationRow[], timezone: string, now: Date): Promise<ObligationView[]> {
  const ids = [...new Set(rows.flatMap((row) => row.sourceDocumentId ? [row.sourceDocumentId] : []))];
  const docs = ids.length ? await tx.document.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, createdAt: true } }) : [];
  const sources = new Map(docs.map((doc) => [doc.id, doc]));
  return rows.map((row) => {
    const source = row.sourceDocumentId ? sources.get(row.sourceDocumentId) : undefined;
    return ObligationViewSchema.parse({
      id: row.id, household_id: row.householdId, item_id: row.itemId, member_id: row.memberId,
      title: row.title, kind: row.kind, direction: row.direction, status: row.status, priority: row.priority,
      due_at: row.dueAt.toISOString(), window_start: iso(row.windowStart), grace_until: iso(row.graceUntil),
      amount_cents: integer(row.amountCents), currency: row.currency, recurrence: row.recurrence,
      source: row.source, source_document_id: source?.id ?? null,
      ai_confidence: row.aiConfidence === null ? null : Number(row.aiConfidence),
      outcome: row.outcome, verified_at: iso(row.verifiedAt),
      item_name: row.item?.name ?? null, member_name: row.member?.displayName ?? null,
      days_until: daysUntil(row.dueAt, timezone, now),
      provenance: source ? { document_id: source.id, document_title: source.title ?? "Source document", captured_at: source.createdAt.toISOString() } : null,
    });
  });
}

const DateCursorSchema = z.tuple([IsoDateTimeSchema, UuidSchema]);
function dateCursor(query: ListQuery<unknown>) {
  if (!query.after) return undefined;
  const parsed = DateCursorSchema.safeParse(query.after);
  if (!parsed.success) throw new HttpProblem("validation", "This page cursor is invalid.");
  const [at, id] = parsed.data;
  return { OR: [{ createdAt: { lt: new Date(at) } }, { createdAt: new Date(at), id: { lt: id } }] };
}
const keyOf = (row: { createdAt: Date; id: string }) => [row.createdAt.toISOString(), row.id];

export async function items({ request, ctx, db }: HandlerInput) {
  const query = listQuery(new URL(request.url), { resource: `items:${ctx.householdId}`, filters: ItemFiltersSchema, sort: "created_at.desc,id.desc" });
  const f = query.filters;
  return db.withHousehold(ctx.householdId, async (tx) => {
    const rows = await tx.item.findMany({ select: ITEM_SELECT, take: query.limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], where: { AND: [
        { householdId: ctx.householdId, ...(f.kind ? { kind: f.kind } : {}), ...(f.member_id ? { memberId: f.member_id } : {}), ...(f.status ? { status: f.status } : {}) },
        ...(f.q ? [{ OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { vendorName: { contains: f.q, mode: "insensitive" as const } }] }] : []),
        ...(query.after ? [dateCursor(query)!] : []),
      ] } });
    const page = pageOf(rows, query, keyOf);
    return { ...page, data: page.data.map(itemView) };
  });
}
export async function documents({ request, ctx, db }: HandlerInput) {
  const query = listQuery(new URL(request.url), { resource: `documents:${ctx.householdId}`, filters: DocumentFiltersSchema, sort: "created_at.desc,id.desc" });
  const f = query.filters;
  return db.withHousehold(ctx.householdId, async (tx) => {
    const rows = await tx.document.findMany({ select: DOCUMENT_SELECT, take: query.limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], where: { AND: [
        { householdId: ctx.householdId, ...(f.status ? { status: { in: f.status } } : {}), ...(f.doc_type ? { docType: f.doc_type } : {}), ...(f.member_id ? { items: { some: { memberId: f.member_id } } } : {}) },
        ...(f.q ? [{ title: { contains: f.q, mode: "insensitive" as const } }] : []),
        ...(query.after ? [dateCursor(query)!] : []),
      ] } });
    const page = pageOf(rows, query, keyOf);
    return { ...page, data: page.data.map(documentView) };
  });
}

export async function obligations({ request, ctx, db }: HandlerInput) {
  const query = listQuery(new URL(request.url), { resource: `obligations:${ctx.householdId}`, filters: ObligationFiltersSchema, sort: "priority.asc,due_at.asc,id.asc" });
  const f = query.filters, now = new Date();
  const after = query.after ? z.tuple([z.number().int().min(1).max(3), IsoDateTimeSchema, UuidSchema]).safeParse(query.after) : null;
  if (after && !after.success) throw new HttpProblem("validation", "This page cursor is invalid.");
  const [priority, at, id] = after?.success ? after.data : [];
  return db.withHousehold(ctx.householdId, async (tx) => {
    const timezone = await timezoneFor(tx, ctx.userId);
    // SQL timezone arithmetic preserves local-calendar semantics over 23/25-hour DST
    // days. Filtering stays an indexed timestamp range, never post-pagination filtering.
    const bounds = f.due_within_days === undefined ? null : (await tx.$queryRaw<Array<{ start: Date; end: Date }>>`
      SELECT date_trunc('day', ${now}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone} AS start,
        (date_trunc('day', ${now}::timestamptz AT TIME ZONE ${timezone}) + (${f.due_within_days} + 1) * INTERVAL '1 day') AT TIME ZONE ${timezone} AS end
    `)[0];
    const rows = await tx.obligation.findMany({ select: OBLIGATION_SELECT, take: query.limit + 1,
      orderBy: [{ priority: "asc" }, { dueAt: "asc" }, { id: "asc" }], where: { AND: [
        { householdId: ctx.householdId, ...(f.status ? { status: { in: f.status } } : {}), ...(f.direction ? { direction: f.direction } : {}), ...(f.member_id ? { memberId: f.member_id } : {}) },
        ...(f.q ? [{ OR: [{ title: { contains: f.q, mode: "insensitive" as const } }, { item: { name: { contains: f.q, mode: "insensitive" as const } } }] }] : []),
        ...(f.due_after ? [{ dueAt: { gte: new Date(f.due_after) } }] : []),
        ...(f.due_before ? [{ dueAt: { lt: new Date(f.due_before) } }] : []),
        ...(bounds ? [{ dueAt: { gte: bounds.start, lt: bounds.end } }] : []),
        ...(priority !== undefined && at && id ? [{ OR: [ { priority: { gt: priority } }, { priority, dueAt: { gt: new Date(at) } }, { priority, dueAt: new Date(at), id: { gt: id } } ] }] : []),
      ] } });
    const page = pageOf(rows, query, (row) => [row.priority, row.dueAt.toISOString(), row.id]);
    return { ...page, data: await obligationViews(tx, page.data, timezone, now) };
  });
}

export function detailId(request: Request): string {
  const id = UuidSchema.safeParse(new URL(request.url).pathname.split("/").at(-1));
  if (!id.success) throw new HttpProblem("not-found", "That record was not found.");
  return id.data;
}
export async function item({ request, ctx, db }: HandlerInput) {
  const id = detailId(request);
  return db.withHousehold(ctx.householdId, (tx) => readItem(tx, id, ctx.householdId));
}
export async function readItem(tx: ScopedClient, id: string, householdId: string) {
  const row = await tx.item.findUnique({ where: { id, householdId }, select: ITEM_SELECT });
  if (!row) throw new HttpProblem("not-found", "That record was not found.");
  return itemView(row);
}
export async function document({ request, ctx, db }: HandlerInput) {
  const id = detailId(request);
  return db.withHousehold(ctx.householdId, async (tx) => {
    const row = await tx.document.findUnique({ where: { id, householdId: ctx.householdId }, select: DOCUMENT_SELECT });
    if (!row) throw new HttpProblem("not-found", "That record was not found.");
    return documentView(row);
  });
}
export async function obligation({ request, ctx, db }: HandlerInput) {
  const id = detailId(request);
  return db.withHousehold(ctx.householdId, (tx) => readObligation(tx, id, ctx.householdId, ctx.userId));
}

export async function readObligation(tx: ScopedClient, id: string, householdId: string, userId: string) {
  const row = await tx.obligation.findUnique({ where: { id, householdId }, select: OBLIGATION_SELECT });
  if (!row) throw new HttpProblem("not-found", "That record was not found.");
  return (await obligationViews(tx, [row], await timezoneFor(tx, userId), new Date()))[0]!;
}
