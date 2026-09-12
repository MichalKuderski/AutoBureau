import { z } from "zod";
import type { Prisma, ScopedClient } from "@autobureau/db";
import { MemberCreateSchema, MemberPatchSchema, MemberViewSchema, UuidSchema, IsoDateTimeSchema, uuidv7 } from "@autobureau/contracts";
import { jsonBody } from "@/server/http/body";
import { listQuery, pageOf } from "@/server/http/list";
import { created, noContent, type HandlerInput } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";

function path(input: HandlerInput) {
  const parts = new URL(input.request.url).pathname.split("/");
  if (parts[3] !== input.ctx.householdId) throw new HttpProblem("not-found", "That household was not found.");
  return parts[5];
}
function memberId(input: HandlerInput) {
  const parsed = UuidSchema.safeParse(path(input));
  if (!parsed.success) throw new HttpProblem("not-found", "That person was not found.");
  return parsed.data;
}
function view(row: Prisma.HouseholdMemberGetPayload<object>) {
  return MemberViewSchema.parse({ id: row.id, household_id: row.householdId, user_id: row.userId,
    display_name: row.displayName, kind: row.kind, date_of_birth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    archived_at: row.archivedAt?.toISOString() ?? null });
}
async function lockMembers(tx: ScopedClient, householdId: string) {
  // Same lock for creates/restores: concurrent requests cannot both consume the last slot.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${householdId}`}, 0))`;
}
async function assertCapacity(tx: ScopedClient, householdId: string) {
  const entitlement = await tx.entitlement.findUnique({ where: { householdId }, select: { membersMax: true } });
  if (!entitlement) throw new HttpProblem("unavailable", "Your household plan could not be loaded.");
  const count = await tx.householdMember.count({ where: { householdId, archivedAt: null } });
  if (count >= entitlement.membersMax) throw new HttpProblem("cap-exceeded", "Your plan’s active-person limit has been reached. Archive someone or review your plan.");
}
export async function listMembers(input: HandlerInput) {
  path(input);
  const query = listQuery(new URL(input.request.url), { resource: `members:${input.ctx.householdId}`,
    filters: z.object({ archived: z.enum(["true", "false"]).optional() }).strict(), sort: "created_at.desc,id.desc" });
  const cursor = query.after ? z.tuple([IsoDateTimeSchema, UuidSchema]).safeParse(query.after) : null;
  if (cursor && !cursor.success) throw new HttpProblem("validation", "This page cursor is invalid.");
  const [at, id] = cursor?.success ? cursor.data : [];
  return input.db.withHousehold(input.ctx.householdId, async (tx) => {
    const rows = await tx.householdMember.findMany({ take: query.limit + 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], where: {
      householdId: input.ctx.householdId, archivedAt: query.filters.archived === "true" ? { not: null } : null,
      ...(at && id ? { OR: [{ createdAt: { lt: new Date(at) } }, { createdAt: new Date(at), id: { lt: id } }] } : {}),
    } });
    const page = pageOf(rows, query, (row) => [row.createdAt.toISOString(), row.id]);
    return { ...page, data: page.data.map(view) };
  });
}
export async function addMember(input: HandlerInput) {
  path(input);
  const body = await jsonBody(input.request, MemberCreateSchema);
  return input.db.withHousehold(input.ctx.householdId, async (tx) => {
    await lockMembers(tx, input.ctx.householdId);
    await assertCapacity(tx, input.ctx.householdId);
    const row = await tx.householdMember.create({ data: { id: uuidv7(), householdId: input.ctx.householdId,
      displayName: body.display_name, kind: body.kind, dateOfBirth: body.date_of_birth ? new Date(body.date_of_birth) : null } });
    return created(view(row), `/v1/households/${input.ctx.householdId}/members/${row.id}`);
  }, { verb: "household.member_added" });
}
export async function editMember(input: HandlerInput) {
  const id = memberId(input);
  const body = await jsonBody(input.request, MemberPatchSchema);
  return input.db.withHousehold(input.ctx.householdId, async (tx) => {
    const row = await tx.householdMember.findUnique({ where: { id, householdId: input.ctx.householdId } });
    if (!row) throw new HttpProblem("not-found", "That person was not found.");
    if (row.archivedAt) throw new HttpProblem("conflict", "Restore this person before editing their details.");
    const date = body.date_of_birth === undefined ? undefined : body.date_of_birth ? new Date(body.date_of_birth) : null;
    const changed = (body.display_name !== undefined && row.displayName !== body.display_name)
      || (body.kind !== undefined && row.kind !== body.kind)
      || (date !== undefined && (date?.getTime() ?? null) !== (row.dateOfBirth?.getTime() ?? null));
    return view(changed ? await tx.householdMember.update({ where: { id }, data: {
      ...(body.display_name === undefined ? {} : { displayName: body.display_name }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(date === undefined ? {} : { dateOfBirth: date }),
    } }) : row);
  }, { verb: "household.member_changed" });
}
export async function archiveMember(input: HandlerInput) {
  const id = memberId(input);
  return input.db.withHousehold(input.ctx.householdId, async (tx) => {
    const row = await tx.householdMember.findUnique({ where: { id, householdId: input.ctx.householdId } });
    if (row && !row.archivedAt) await tx.householdMember.update({ where: { id }, data: { archivedAt: new Date() } });
    return noContent();
  }, { verb: "household.member_archived" });
}
export async function restoreMember(input: HandlerInput) {
  const id = memberId(input);
  await jsonBody(input.request, z.object({}).strict());
  return input.db.withHousehold(input.ctx.householdId, async (tx) => {
    await lockMembers(tx, input.ctx.householdId);
    const row = await tx.householdMember.findUnique({ where: { id, householdId: input.ctx.householdId } });
    if (!row) throw new HttpProblem("not-found", "That person was not found.");
    if (!row.archivedAt) return view(row);
    if (Date.now() - row.archivedAt.getTime() > 30 * 86_400_000) throw new HttpProblem("conflict", "The 30-day restore window has ended.");
    await assertCapacity(tx, input.ctx.householdId);
    return view(await tx.householdMember.update({ where: { id }, data: { archivedAt: null } }));
  }, { verb: "household.member_restored" });
}
