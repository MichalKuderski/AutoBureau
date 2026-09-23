import { z } from "zod";
import { StripeTestStateSchema } from "./stripe-test-journal.js";
import { ItemKindSchema, ItemStatusSchema, ObligationKindSchema, ObligationStatusSchema, DocStatusSchema, MemberKindSchema, ReminderStatusSchema } from "./domain/common.js";
export const PrivacyExportIdSchema = z.string().uuid();
export const PrivacyExportSourceSchema = z.enum(["items", "obligations"]);
export const PrivacyExportCursorSchema = z.object({ householdId: PrivacyExportIdSchema, requestId: PrivacyExportIdSchema, source: PrivacyExportSourceSchema, after: PrivacyExportIdSchema }).strict();
export const PrivacyExportIntentSchema = z.object({ version: z.literal(1), requested_by: PrivacyExportIdSchema }).strict();
export type PrivacyExportCursor = z.infer<typeof PrivacyExportCursorSchema>;

const nullableId = PrivacyExportIdSchema.nullable();
const money = z.string().regex(/^-?\d{1,19}$/).nullable();
const currency = z.string().regex(/^[A-Z]{3}$/).nullable();
const instant = z.string().datetime({ offset: true });
const rows = <T extends z.ZodTypeAny>(s: T) => z.array(s).max(1000);
/** Deliberately partial closed projection. No free text/attrs, secret fields,
 * ciphertext, provider references or storage capability can enter this artifact. */
export const LocalExportSnapshotSchema = z.object({
  version: z.literal(2), scope: z.literal("household"), complete: z.literal(false),
  householdId: PrivacyExportIdSchema, requestId: PrivacyExportIdSchema, ownerId: PrivacyExportIdSchema,
  snapshotAt: instant, expiresAt: instant,
  account: z.object({ email:z.string().email().max(320),status:z.enum(["active","suspended","deletion_pending"]),createdAt:instant }).strict(),
  profile:z.object({displayName:z.string().max(300),locale:z.string().max(35),timezone:z.string().max(100),country:z.string().length(2)}).strict().nullable(),
  household:z.object({name:z.string().max(300),createdAt:instant}).strict(),
  notificationPreferences:rows(z.object({kind:z.string().max(80),channel:z.enum(["email","push","inapp"]),enabled:z.boolean()}).strict()),
  notificationHistory:rows(z.object({id:PrivacyExportIdSchema,kind:z.string().max(80),createdAt:instant,readAt:instant.nullable(),targetId:nullableId}).strict()),
  activityHistory:rows(z.object({id:z.string().regex(/^\d{1,19}$/),action:z.string().max(120),targetType:z.string().max(120),targetId:nullableId,createdAt:instant}).strict()),
  items: rows(z.object({ id: PrivacyExportIdSchema, memberId: nullableId, kind: ItemKindSchema, status: ItemStatusSchema, amountCents: money, currency, sourceDocumentId: nullableId }).strict()),
  obligations: rows(z.object({ id: PrivacyExportIdSchema, itemId: nullableId, memberId: nullableId, kind: ObligationKindSchema, status: ObligationStatusSchema,
    amountCents: money, currency, source: z.enum(["ai", "user", "system"]), sourceDocumentId: nullableId, dueAt: instant }).strict()),
  documents: rows(z.object({ id: PrivacyExportIdSchema, status: DocStatusSchema, sizeBytes: z.string().regex(/^\d{1,19}$/), source: z.enum(["upload", "email", "api"]) }).strict()),
  members: rows(z.object({ id: PrivacyExportIdSchema, kind: MemberKindSchema, archivedAt: instant.nullable() }).strict()),
  reminders: rows(z.object({ id: PrivacyExportIdSchema, obligationId: PrivacyExportIdSchema, remindAt: instant, status: ReminderStatusSchema }).strict()),
  documentWork: z.object({version:z.literal(1),
    custody:rows(z.object({documentId:PrivacyExportIdSchema,state:z.enum(["copying","ready","held","cancelled","absent"]),reviewAt:instant}).strict()),
    processing:rows(z.object({documentId:PrivacyExportIdSchema,state:z.enum(["waiting","reserved","started","completed","failed","indeterminate","cancelled"]),periodStart:instant.nullable(),chargedAt:instant.nullable()}).strict()),
  }).strict().optional(), // Historical immutable V2 artifacts predate this category.
  testSubscription: StripeTestStateSchema.innerType().pick({state:true,plan:true,paidThrough:true,premiumUntil:true}).extend({
    mode:z.literal("test"),applicationEntitlementActivated:z.literal(false),reconciledAt:instant,
  }).strict().nullable(),
  entitlements: z.array(z.object({ plan: z.enum(["free", "premium"]), docsPerMonth: z.number().int().nonnegative(), membersMax: z.number().int().nonnegative(), docsUsedThisPeriod: z.number().int().nonnegative() }).strict()).max(1),
}).strict();
export type LocalExportSnapshot = z.infer<typeof LocalExportSnapshotSchema>;
export const LOCAL_EXPORT_OMISSIONS = Object.freeze(["original-documents", "identifier-reveal", "record-names-and-free-text", "attributes-and-extracted-content", "internal-and-unclassified-audit", "notification-text-and-delivery-provider-data", "financial-provider-records", "zip-artifact"]);

/** Read historical authenticated artifacts without manufacturing fields which were
 * not captured. V1 is kept V1; pre-billing V2 may omit testSubscription. Writers
 * continue to require the full current V2 schema. Unknown versions/fields refuse. */
export const LegacyLocalExportSnapshotSchema = LocalExportSnapshotSchema.pick({
 scope:true,complete:true,householdId:true,requestId:true,ownerId:true,snapshotAt:true,expiresAt:true,
 items:true,obligations:true,documents:true,members:true,reminders:true,entitlements:true,
}).extend({version:z.literal(1)}).strict();
export const ReadableLocalExportSnapshotSchema = z.discriminatedUnion("version",[
 LegacyLocalExportSnapshotSchema,
 LocalExportSnapshotSchema.extend({testSubscription:LocalExportSnapshotSchema.shape.testSubscription.optional()}).strict(),
]);
export type ReadableLocalExportSnapshot=z.infer<typeof ReadableLocalExportSnapshotSchema>;
export function localExportOmissions(snapshot:ReadableLocalExportSnapshot):readonly string[]{
 return snapshot.version===1?[...LOCAL_EXPORT_OMISSIONS,"account-and-profile","household-name","notifications-and-preferences","audit-trail","test-subscription-state","document-work-state"]
 : [...LOCAL_EXPORT_OMISSIONS,...(snapshot.testSubscription===undefined?["test-subscription-state"]:[]),...(snapshot.documentWork===undefined?["document-work-state"]:[])];
}
