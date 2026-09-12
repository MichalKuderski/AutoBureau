import { z } from "zod";
import { Prisma, recordAudit } from "@autobureau/db";
import { canonicalize } from "@autobureau/contracts/node";
import { IsoDateTimeSchema, UuidSchema, NotificationLensSchema, NotificationReadSchema, NotificationViewSchema,
  NotificationSettingsSaveSchema, NotificationSettingsViewSchema, NotificationScheduleSchema,
  defaultNotificationPreferences, defaultNotificationSchedule } from "@autobureau/contracts";
import type { HandlerInput } from "@/server/http/route";
import { listQuery, pageOf } from "@/server/http/list";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";

const filters = z.object({ lens: NotificationLensSchema.default("all") }).strict();
const cursor = z.tuple([IsoDateTimeSchema, UuidSchema]);
type NoticeRow = { id: string; kind: string; title: string; body: string; created_at: string; read_at: string | null; target_type: string | null; target_id: string | null };
export async function notifications({ request, ctx, db }: HandlerInput) {
  const query = listQuery(new URL(request.url), { resource: `notifications:${ctx.householdId}:${ctx.userId}`, filters, sort: "created_at.desc,id.desc" });
  const after = query.after ? cursor.safeParse(query.after) : null;
  if (after && !after.success) throw new HttpProblem("validation", "This page cursor is invalid.");
  return db.withHousehold(ctx.householdId, async (tx) => {
    const rows = await tx.$queryRaw<NoticeRow[]>(Prisma.sql`
      SELECT id, kind, title, body, target_type, target_id,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
        to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_at
      FROM public.notifications WHERE household_id = ${ctx.householdId}::uuid AND user_id = ${ctx.userId}::uuid
        ${query.filters.lens === "unread" ? Prisma.sql`AND read_at IS NULL` : Prisma.empty}
        ${after?.success ? Prisma.sql`AND (created_at, id) < (${after.data[0]}::timestamptz, ${after.data[1]}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`);
    const page = pageOf(rows, query, (row) => [row.created_at, row.id]);
    const ids = page.data.flatMap((row) => row.target_type === "obligation" && row.target_id ? [row.target_id] : []);
    const obligations = await tx.obligation.findMany({ where: { householdId: ctx.householdId, id: { in: ids } }, select: { id: true } });
    const known = new Set(obligations.map((row) => row.id));
    return { ...page, data: page.data.map((row) => NotificationViewSchema.parse({ ...row,
      // Never store or trust arbitrary URLs. Stale/foreign targets have no link.
      href: row.target_type === "obligation" && row.target_id && known.has(row.target_id) ? `/obligations/${row.target_id}`
        : row.kind === "digest.weekly" && row.target_id === null ? "/dashboard"
        : row.kind === "security" && row.target_id === null ? "/settings/profile" : null,
    })) };
  });
}
export async function readNotifications({ request, ctx, db }: HandlerInput) {
  const body = await jsonBody(request, NotificationReadSchema);
  return db.withHousehold(ctx.householdId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notifications:${ctx.householdId}:${ctx.userId}`}, 0))`;
    const rows = await tx.notification.findMany({ where: { householdId: ctx.householdId, userId: ctx.userId, id: { in: body.ids } }, select: { id: true, readAt: true } });
    const unread = rows.filter((row) => row.readAt === null).map((row) => row.id);
    if (unread.length) await tx.notification.updateMany({ where: { householdId: ctx.householdId, userId: ctx.userId, id: { in: unread }, readAt: null }, data: { readAt: new Date() } });
    // Foreign and absent ids are equally ignored; repeats preserve the original timestamp.
    return { read_ids: rows.map((row) => row.id), changed: unread.length };
  });
}
const StoredScheduleSchema = z.object({ version: z.literal(1), schedule: NotificationScheduleSchema }).strict();
function storedSchedule(value: Prisma.JsonValue) {
  const root = z.record(z.unknown()).safeParse(value);
  if (!root.success) throw new HttpProblem("unavailable", "Your notification preferences could not be loaded.");
  const state = root.data.notifications === undefined ? { success: true as const, data: { version: 1, schedule: defaultNotificationSchedule() } }
    : StoredScheduleSchema.safeParse(root.data.notifications);
  if (!state.success) throw new HttpProblem("unavailable", "Your notification preferences could not be loaded.");
  return { root: root.data, schedule: state.data.schedule };
}
export async function notificationSettings({ request, ctx, db }: HandlerInput) {
  const body = request.method === "PATCH" ? await jsonBody(request, NotificationSettingsSaveSchema) : null;
  return db.withHousehold(ctx.householdId, async (tx) => {
    // Shared with setup: both namespaces live in the same principal's profile JSON.
    if (body) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding:${ctx.userId}`}, 0))`;
    const profile = await tx.userProfile.findUnique({ where: { userId: ctx.userId }, select: { onboarding: true, timezone: true } });
    if (!profile) throw new HttpProblem("not-found", "Your profile was not found.");
    const saved = storedSchedule(profile.onboarding);
    const stored = await tx.notificationPreference.findMany({ where: { userId: ctx.userId }, select: { kind: true, channel: true, enabled: true } });
    const preferences = defaultNotificationPreferences().map((row) => ({ ...row, enabled: stored.find((current) => current.kind === row.kind && current.channel === row.channel)?.enabled ?? row.enabled }));
    if (!body) return NotificationSettingsViewSchema.parse({ preferences, schedule: saved.schedule, timezone: profile.timezone });
    let changed = false;
    for (const row of body.preferences) {
      const current = preferences.find((candidate) => candidate.kind === row.kind && candidate.channel === row.channel)!;
      if (row.enabled === current.enabled) continue;
      await tx.notificationPreference.upsert({ where: { userId_kind_channel: { userId: ctx.userId, kind: row.kind, channel: row.channel } },
        create: { userId: ctx.userId, ...row }, update: { enabled: row.enabled } });
      changed = true;
    }
    if (canonicalize(saved.schedule) !== canonicalize(body.schedule)) {
      await tx.userProfile.update({ where: { userId: ctx.userId }, data: { onboarding: { ...saved.root, notifications: { version: 1, schedule: body.schedule } } as Prisma.InputJsonObject } });
      changed = true;
    }
    if (changed) await recordAudit(tx, "notification.preferences_changed", { type: "userprofile", id: ctx.userId });
    return NotificationSettingsViewSchema.parse({ ...body, timezone: profile.timezone });
  });
}
