import { z } from "zod";
import { CensusSelectionsSchema, OnboardingSaveSchema, OnboardingViewSchema, UuidSchema, seedFromCensus, uuidv7 } from "@autobureau/contracts";
import { canonicalize } from "@autobureau/contracts/node";
import { outbox, recordAudit, type Prisma, type ScopedClient } from "@autobureau/db";
import type { HandlerInput } from "@/server/http/route";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const StateSchema = z.object({
  version: z.literal(1), caring_for: z.enum(["self", "self_and_elder"]).nullable(),
  members: z.record(UuidSchema, UuidSchema), selections: CensusSelectionsSchema,
  census_subject_ref: UuidSchema.nullable(), seeded_items: z.record(z.string(), UuidSchema), complete: z.boolean(),
});
type State = z.infer<typeof StateSchema>;
const emptyState = (): State => ({ version: 1, caring_for: null, members: {}, selections: [], census_subject_ref: null, seeded_items: {}, complete: false });
function stored(value: Prisma.JsonValue, householdId: string) {
  const root = z.record(z.unknown()).safeParse(value);
  if (!root.success) throw new HttpProblem("unavailable", "Your saved setup could not be loaded.");
  const households = z.record(z.unknown()).safeParse(root.data.households ?? {});
  if (!households.success) throw new HttpProblem("unavailable", "Your saved setup could not be loaded.");
  const current = households.data[householdId];
  const parsed = current === undefined ? { success: true as const, data: emptyState() } : StateSchema.safeParse(current);
  if (!parsed.success) throw new HttpProblem("unavailable", "Your saved setup could not be loaded.");
  return { root: root.data, households: households.data, state: parsed.data };
}
export async function setupCoverage(tx: ScopedClient, householdId: string, userId: string, verifiedTotal: number) {
  const profile = await tx.userProfile.findUnique({ where: { userId }, select: { onboarding: true } });
  if (!profile) return { captured: verifiedTotal, expected: null };
  const { state } = stored(profile.onboarding, householdId);
  if (!state.selections.length) return { captured: verifiedTotal, expected: null };
  const subject = state.census_subject_ref ? state.members[state.census_subject_ref] : "household";
  const ids = state.selections.flatMap((prompt) => state.seeded_items[`${subject}:${prompt}`] ? [state.seeded_items[`${subject}:${prompt}`]!] : []);
  // This measures only the saved census selections, not completeness of the whole
  // household. Unrelated verified records must never inflate this denominator.
  const captured = await tx.item.count({ where: { householdId, id: { in: ids },
    status: { not: "archived" }, verifiedAt: { not: null } } });
  return { captured, expected: state.selections.length };
}
async function view(tx: ScopedClient, householdId: string, state: State) {
  const members = await tx.householdMember.findMany({ where: { householdId, archivedAt: null }, take: 26, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, displayName: true, kind: true } });
  if (members.length > 25) throw new HttpProblem("conflict", "This setup supports up to 25 people. Manage your household in Settings.");
  const refs = new Map(Object.entries(state.members).map(([ref, id]) => [id, ref]));
  const rows = members.map((member) => ({ client_ref: refs.get(member.id) ?? member.id, member_id: member.id,
    display_name: member.displayName, kind: member.kind }));
  const subject = rows.find((member) => member.client_ref === state.census_subject_ref);
  const subjectId = subject?.member_id ?? "household";
  const itemIds = state.selections.flatMap((prompt) => state.seeded_items[`${subjectId}:${prompt}`] ? [state.seeded_items[`${subjectId}:${prompt}`]!] : []);
  return OnboardingViewSchema.parse({ household_id: householdId, caring_for: state.caring_for,
    members: rows, selections: state.selections, census_subject_ref: subject?.client_ref ?? null, complete: state.complete,
    records_saved: await tx.item.count({ where: { householdId, id: { in: itemIds } } }),
    documents_added: await tx.document.count({ where: { householdId } }),
  });
}
export async function onboarding({ request, ctx, db }: HandlerInput) {
  const body = request.method === "PATCH" ? await jsonBody(request, OnboardingSaveSchema) : null;
  return db.withHousehold(ctx.householdId, async (tx) => {
    if (body) {
      // One account's setup JSON can contain several household namespaces. Serialize
      // edits at the principal to prevent one household replacing another's progress.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding:${ctx.userId}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${ctx.householdId}`}, 0))`;
    }
    const profile = await tx.userProfile.findUnique({ where: { userId: ctx.userId }, select: { onboarding: true } });
    if (!profile) throw new HttpProblem("not-found", "Your profile was not found.");
    const saved = stored(profile.onboarding, ctx.householdId);
    if (!body) return view(tx, ctx.householdId, saved.state);
    const state: State = { ...saved.state, members: { ...saved.state.members }, seeded_items: { ...saved.state.seeded_items } };
    const entitlement = await tx.entitlement.findUnique({ where: { householdId: ctx.householdId }, select: { membersMax: true } });
    if (!entitlement) throw new HttpProblem("unavailable", "Your household plan could not be loaded.");
    let count = await tx.householdMember.count({ where: { householdId: ctx.householdId, archivedAt: null } });
    for (const member of body.members) {
      const mapped = state.members[member.client_ref];
      if (mapped && member.member_id && mapped !== member.member_id) throw new HttpProblem("conflict", "This person's saved reference has changed. Reload your setup.");
      const memberId = mapped ?? member.member_id;
      if (memberId) {
        if (Object.entries(state.members).some(([ref, id]) => id === memberId && ref !== member.client_ref)) {
          throw new HttpProblem("conflict", "This person's saved reference has changed. Reload your setup.");
        }
        const existing = await tx.householdMember.findFirst({ where: { id: memberId, householdId: ctx.householdId, archivedAt: null } });
        if (!existing) throw new HttpProblem("not-found", "That active person was not found.");
        if (existing.displayName !== member.display_name || existing.kind !== member.kind) {
          await tx.householdMember.update({ where: { id: memberId, householdId: ctx.householdId }, data: { displayName: member.display_name, kind: member.kind } });
          await recordAudit(tx, "household.member_changed", { type: "householdmember", id: memberId });
        }
        state.members[member.client_ref] = memberId;
      } else {
        if (count >= entitlement.membersMax) throw new HttpProblem("cap-exceeded", "Your plan’s active-person limit has been reached. Manage people in Settings before adding another.");
        const id = uuidv7();
        await tx.householdMember.create({ data: { id, householdId: ctx.householdId, displayName: member.display_name, kind: member.kind, createdAt: new Date() } });
        await recordAudit(tx, "household.member_added", { type: "householdmember", id });
        state.members[member.client_ref] = id; count++;
      }
    }
    state.caring_for = body.caring_for;
    state.selections = body.selections;
    state.census_subject_ref = body.census_subject_ref;
    if (body.stage !== "household") {
      const memberId = body.census_subject_ref ? state.members[body.census_subject_ref] : null;
      // Only selected prompt IDs are accepted. Names, kinds and whether a date is
      // missing come from the shared catalogue, never a client-supplied item template.
      const seed = seedFromCensus(body.selections, memberId ? { id: memberId, name: "" } : null);
      for (const item of seed.items) {
        const key = `${memberId ?? "household"}:${item.promptId}`;
        // Remember prior seeding even if a record was later deleted. Replaying setup
        // must not silently resurrect a user's removed ledger entry.
        if (state.seeded_items[key]) continue;
        const id = uuidv7();
        await tx.item.create({ data: { id, householdId: ctx.householdId, memberId: memberId ?? null, name: item.name, kind: item.kind, createdAt: new Date() } });
        await outbox(tx).emit({ event_type: "item.created", household_id: ctx.householdId, aggregate_type: "item", aggregate_id: id,
          payload: { source: "census", kind: item.kind } });
        state.seeded_items[key] = id;
      }
      // No obligation/reminder row: the census contains no evidenced date.
    }
    if (body.stage === "complete") state.complete = true;
    const next = { ...saved.root, households: { ...saved.households, [ctx.householdId]: state } } as Prisma.InputJsonObject;
    if (canonicalize(next) !== canonicalize(profile.onboarding)) {
      await tx.userProfile.update({ where: { userId: ctx.userId }, data: { onboarding: next } });
    }
    return view(tx, ctx.householdId, state);
  });
}
