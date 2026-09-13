import { z } from "zod";
import { IsoDateTimeSchema, NotificationChannelSchema, UuidSchema } from "./common.js";
import { TimezoneSchema } from "./settings.js";

export const NOTIFICATION_KINDS = ["obligation.due_soon", "document.needs_review", "digest.weekly", "value.found", "security"] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export const NotificationLensSchema = z.enum(["all", "unread"]);
export const NotificationViewSchema = z.object({
  id: UuidSchema, kind: z.string().max(80), title: z.string().max(300), body: z.string().max(2000),
  created_at: IsoDateTimeSchema, read_at: IsoDateTimeSchema.nullable(),
  href: z.string().nullable(),
});
export const NotificationReadSchema = z.object({ ids: z.array(UuidSchema).min(1).max(100) }).strict();
export const NotificationPreferenceSchema = z.object({
  kind: NotificationKindSchema, channel: NotificationChannelSchema, enabled: z.boolean(),
}).strict().refine((value) => value.kind !== "security" || value.enabled, "Security notices are always enabled.");
const ClockSchema = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/, "Choose a valid local time.");
export const NotificationScheduleSchema = z.object({
  quiet_start: ClockSchema, quiet_end: ClockSchema, urgent_override: z.boolean(),
  digest_day: z.number().int().min(0).max(6), digest_time: ClockSchema,
}).strict().refine((value) => value.quiet_start !== value.quiet_end, "Quiet hours must have different start and end times.");
export const NotificationSettingsSaveSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema).length(15).refine((rows) => new Set(rows.map((row) => `${row.kind}:${row.channel}`)).size === 15, "Each notification type and channel must appear once."),
  schedule: NotificationScheduleSchema,
}).strict();
export const NotificationSettingsViewSchema = NotificationSettingsSaveSchema.extend({ timezone: TimezoneSchema });
export const defaultNotificationSchedule = () => ({ quiet_start: "21:00", quiet_end: "08:00", urgent_override: false, digest_day: 0, digest_time: "17:00" });
/** doc 08: critical reminders email+push, review in-app+push, digest email. */
export function defaultNotificationPreferences() {
  return NOTIFICATION_KINDS.flatMap((kind) => NotificationChannelSchema.options.map((channel) => ({
    kind, channel, enabled: kind === "security" || (kind === "obligation.due_soon" ? channel !== "inapp"
      : kind === "document.needs_review" ? channel !== "email" : channel === "email"),
  })));
}
export type NotificationView = z.infer<typeof NotificationViewSchema>;
export type NotificationLens = z.infer<typeof NotificationLensSchema>;
export type NotificationSettingsSave = z.infer<typeof NotificationSettingsSaveSchema>;
export type NotificationSettingsView = z.infer<typeof NotificationSettingsViewSchema>;
