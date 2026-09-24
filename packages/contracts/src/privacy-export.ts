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

/* ---------- Export v3: complete household archive (originals + JSONL + manifest) ---------- */
const json = z.unknown();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max);
const many = <T extends z.ZodTypeAny>(s: T) => z.array(s).max(10000);
/** Every category the household ledger holds, with names, free text, attributes and
 * extracted content. Excluded by design (not user data or not exportable safely):
 * storage paths, internal error payloads, secret ciphertext/keys, provider tokens,
 * provider IDs, cursors, leases and transport capabilities. */
export const ExportSnapshotV3Schema = z.object({
  version: z.literal(3), scope: z.literal("household"),
  householdId: PrivacyExportIdSchema, requestId: PrivacyExportIdSchema, ownerId: PrivacyExportIdSchema,
  snapshotAt: instant, expiresAt: instant,
  account: z.object({ email: z.string().email().max(320), status: z.enum(["active","suspended","deletion_pending"]), createdAt: instant }).strict(),
  profile: z.object({ displayName: text(300), locale: text(35), timezone: text(100), country: z.string().length(2), onboarding: json }).strict().nullable(),
  household: z.object({ name: text(300), emailAlias: text(320).nullable(), createdAt: instant }).strict(),
  members: many(z.object({ id: PrivacyExportIdSchema, displayName: text(300), kind: MemberKindSchema, dateOfBirth: date.nullable(), isAccountHolder: z.boolean(), archivedAt: instant.nullable(), createdAt: instant }).strict()),
  items: many(z.object({ id: PrivacyExportIdSchema, memberId: nullableId, kind: ItemKindSchema, name: text(1000), status: ItemStatusSchema, vendorName: text(1000).nullable(),
    attributes: json, amountCents: money, currency, billingCycle: text(100).nullable(), validFrom: date.nullable(), expiresAt: date.nullable(),
    verifiedAt: instant.nullable(), sourceDocumentId: nullableId, createdAt: instant, updatedAt: instant }).strict()),
  obligations: many(z.object({ id: PrivacyExportIdSchema, itemId: nullableId, memberId: nullableId, title: text(1000), kind: ObligationKindSchema,
    direction: z.enum(["owed_by_household","owed_to_household"]), status: ObligationStatusSchema, priority: z.number().int(), dueAt: instant,
    windowStart: instant.nullable(), graceUntil: instant.nullable(), amountCents: money, currency, recurrence: text(200).nullable(),
    source: z.enum(["ai","user","system"]), sourceDocumentId: nullableId, aiConfidence: z.string().regex(/^\d(\.\d{1,3})?$/).nullable(), outcome: json,
    verifiedAt: instant.nullable(), createdAt: instant, updatedAt: instant }).strict()),
  reminders: many(z.object({ id: PrivacyExportIdSchema, obligationId: PrivacyExportIdSchema, remindAt: instant, offsetLabel: text(100), status: ReminderStatusSchema, sentAt: instant.nullable() }).strict()),
  documents: many(z.object({ id: PrivacyExportIdSchema, source: z.enum(["upload","email","api"]), mediaType: text(100), sizeBytes: z.string().regex(/^\d{1,19}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), status: DocStatusSchema, documentType: text(100).nullable(), title: text(1000).nullable(),
    documentDate: date.nullable(), confidence: z.string().regex(/^\d(\.\d{1,3})?$/).nullable(), extracted: json, review: json, processedAt: instant.nullable(), createdAt: instant }).strict()),
  documentWork: LocalExportSnapshotSchema.shape.documentWork.unwrap(),
  notifications: many(z.object({ id: PrivacyExportIdSchema, kind: text(80), title: text(300), body: text(2000), targetType: text(32).nullable(), targetId: nullableId, createdAt: instant, readAt: instant.nullable() }).strict()),
  notificationPreferences: many(z.object({ kind: text(80), channel: z.enum(["email","push","inapp"]), enabled: z.boolean() }).strict()),
  auditTrail: many(z.object({ id: z.string().regex(/^\d{1,19}$/), action: text(120), targetType: text(120), targetId: nullableId, actorType: z.enum(["user","agent","system"]), createdAt: instant }).strict()),
  financialConnections: many(z.object({ id: PrivacyExportIdSchema, state: z.enum(["active","login-required","revoked","unlinking","removal-indeterminate","removed"]), statusChangedAt: instant, createdAt: instant }).strict()),
  financialAccounts: many(z.object({ id: PrivacyExportIdSchema, connectionId: PrivacyExportIdSchema, name: text(80), kind: z.enum(["depository","credit","loan","investment","other"]),
    currency: z.literal("USD"), currentCents: money, availableCents: money, updatedAt: instant }).strict()),
  financialTransactions: many(z.object({ id: PrivacyExportIdSchema, connectionId: PrivacyExportIdSchema, accountId: PrivacyExportIdSchema, postedOn: date,
    amountCents: z.string().regex(/^-?\d{1,19}$/), currency: z.literal("USD"), description: text(120), pending: z.boolean(), updatedAt: instant }).strict()),
  testSubscription: LocalExportSnapshotSchema.shape.testSubscription,
  entitlements: LocalExportSnapshotSchema.shape.entitlements,
  /** No application path writes identifier values and no reveal boundary exists (ADR-007).
   * Count only; any nonzero count makes the export incomplete, never silently omitted. */
  identifiers: z.object({ stored: z.number().int().nonnegative(), exported: z.literal(0) }).strict(),
}).strict();
export type ExportSnapshotV3 = z.infer<typeof ExportSnapshotV3Schema>;
export const EXPORT_V3_CATEGORIES = Object.freeze(["account","profile","household","members","items","obligations","reminders","documents","documentWork","notifications",
  "notificationPreferences","auditTrail","financialConnections","financialAccounts","financialTransactions","testSubscription","entitlements"] as const);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const member = z.string().regex(/^(manifest\.json|README\.txt|data\/[a-zA-Z]+\.jsonl|originals\/[a-f0-9-]{36}\.(pdf|jpg|png|heic|eml|bin))$/);
export const ExportArchiveManifestSchema = z.object({
  format: z.literal("pellum-household-export"), version: z.literal(3),
  householdId: PrivacyExportIdSchema, requestId: PrivacyExportIdSchema, snapshotAt: instant, expiresAt: instant, complete: z.boolean(),
  categories: z.array(z.object({ name: z.enum(EXPORT_V3_CATEGORIES), file: member, records: z.number().int().nonnegative(), sha256: sha, schema: z.string().regex(/^pellum\.export\.[a-zA-Z]+\.v3$/) }).strict()).max(40),
  originals: z.object({
    included: z.array(z.object({ documentId: PrivacyExportIdSchema, file: member, bytes: z.number().int().positive(), sha256: sha, mediaType: z.string().max(100) }).strict()).max(10000),
    notIncluded: z.array(z.object({ documentId: PrivacyExportIdSchema, reason: z.enum(["not-scanned-clean","rejected-by-scanner","no-longer-retained","not-yet-in-custody"]) }).strict()).max(10000),
  }).strict(),
  omissions: z.array(z.object({ category: z.string().max(80), reason: z.string().max(300) }).strict()).max(40),
  notHeldByPellum: z.array(z.string().max(300)).max(10),
  integrity: z.object({ algorithm: z.literal("sha256"), note: z.string().max(300) }).strict(),
}).strict();
export type ExportArchiveManifest = z.infer<typeof ExportArchiveManifestSchema>;
