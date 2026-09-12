import { DocumentUploadInputSchema, DocumentUploadTicketSchema, DocumentCompletionInputSchema, DocumentCompletionSchema, UuidSchema, UploadMimeSchema, uuidv7 } from "@autobureau/contracts";
import { outbox, type ScopedClient } from "@autobureau/db";
import { jsonBody } from "@/server/http/body";
import { HttpProblem } from "@/server/http/problem";
import { accepted, created, type HandlerInput } from "@/server/http/route";
import { householdRef, log, routeOf, traceIdFrom } from "@/server/observability";
import { QuarantineStorage, StorageError, storageConfigFromEnv } from "@/server/storage/quarantine";

async function storageOperation<T>(input: HandlerInput, action: (storage: QuarantineStorage) => Promise<T>): Promise<T> {
  let storage: QuarantineStorage | undefined;
  try {
    // Enable only after provider enforcement, scanner and dispatch gates pass.
    if (process.env["DOCUMENT_INTAKE_ENABLED"] !== "true") throw new StorageError("unavailable");
    storage = new QuarantineStorage(storageConfigFromEnv());
    return await action(storage);
  } catch (cause) {
    if (!(cause instanceof StorageError)) throw cause;
    log({ event: "storage.operation_failed", level: cause.code === "unavailable" ? "error" : "warn",
      traceId: traceIdFrom(input.request), route: routeOf(input.request), household: householdRef(input.ctx.householdId), error: cause });
    if (cause.code === "unavailable") throw new HttpProblem("unavailable", "Document intake is temporarily unavailable. Your existing records are safe.");
    if (cause.code === "invalid-object") throw new HttpProblem("validation", "The uploaded file does not match its expected size or type.");
    throw new HttpProblem("conflict", "The file has not arrived or changed during upload. Try uploading it again.");
  } finally { storage?.close(); }
}
async function quota(tx: ScopedClient, householdId: string, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upload-quota:${householdId}`}, 0))`;
  const row = await tx.entitlement.findUnique({ where: { householdId } });
  if (!row || row.docsPerMonth < 0 || row.docsUsedThisPeriod < 0 || row.periodStart > now) throw new HttpProblem("unavailable", "Your document allowance could not be loaded.");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Document allowances renew by UTC calendar month, independently of payment cadence.
  const used = row.periodStart < start ? 0 : row.docsUsedThisPeriod;
  return { ...row, periodStart: row.periodStart < start ? start : row.periodStart, docsUsedThisPeriod: used };
}
const atCapacity = () => new HttpProblem("cap-exceeded", "Your document allowance is fully used or reserved by uploads in progress. Finish an upload or wait for its link to expire.");

export async function createDocumentUpload(input: HandlerInput) {
  const body = await jsonBody(input.request, DocumentUploadInputSchema);
  return storageOperation(input, async (storage) => {
    const id = uuidv7(), key = `hh/${input.ctx.householdId}/upload/${id}/incoming`;
    const ticket = await storage.issue({ key, mime: body.mime, size: body.size });
    await input.db.withHousehold(input.ctx.householdId, async (tx) => {
      const now = new Date(), allowance = await quota(tx, input.ctx.householdId, now);
      const pending = await tx.documentUpload.count({ where: { expiresAt: { gt: now }, completedAt: null, document: { householdId: input.ctx.householdId, status: "received" } } });
      if (allowance.docsUsedThisPeriod + pending >= allowance.docsPerMonth) throw atCapacity();
      // Filenames can carry identifiers. Never copy them into keys, titles, audits,
      // logs or events; a sanitized extraction supplies a useful title later.
      await tx.document.create({ data: { id, householdId: input.ctx.householdId, uploadedBy: input.ctx.userId,
        source: "upload", status: "received", storagePath: key, mimeType: body.mime, sizeBytes: body.size, sha256: null, title: "Uploaded document" } });
      await tx.documentUpload.create({ data: { documentId: id, objectKey: key, expiresAt: ticket.expiresAt } });
    });
    return created(DocumentUploadTicketSchema.parse({ document_id: id, status: "received", signed_url: ticket.url,
      expires_at: ticket.expiresAt.toISOString(), method: "PUT", headers: { "content-type": body.mime } }), `/v1/documents/${id}`);
  });
}
export async function completeDocumentUpload(input: HandlerInput) {
  const parsed = UuidSchema.safeParse(new URL(input.request.url).pathname.split("/")[3]);
  if (!parsed.success) throw new HttpProblem("not-found", "That document was not found.");
  const id = parsed.data;
  await jsonBody(input.request, DocumentCompletionInputSchema);
  const read = (tx: ScopedClient) => tx.document.findFirst({ where: { id, householdId: input.ctx.householdId }, include: { upload: true } });
  const initial = await input.db.withHousehold(input.ctx.householdId, read);
  if (!initial) throw new HttpProblem("not-found", "That document was not found.");
  if (!initial.upload) throw new HttpProblem("conflict", "This document has no pending upload.");
  const response = (status: string) => accepted(DocumentCompletionSchema.parse({ document_id: id, status }));
  if (initial.status !== "received") return response(initial.status);
  if (initial.upload.completedAt || initial.upload.expiresAt <= new Date()) throw new HttpProblem("conflict", "This upload link has expired. Start a new upload.");
  return storageOperation(input, async (storage) => {
    const destination = `hh/${input.ctx.householdId}/upload/${id}/sealed/${uuidv7()}`;
    await storage.seal({ key: initial.upload!.objectKey, mime: UploadMimeSchema.parse(initial.mimeType), size: Number(initial.sizeBytes) }, destination);
    // Each attempt copied to a different key. Only the transaction's selected key
    // becomes authoritative. Never delete after an ambiguous transaction failure.
    const chosen = await input.db.withHousehold(input.ctx.householdId, async (tx) => {
      const now = new Date(), allowance = await quota(tx, input.ctx.householdId, now), row = await read(tx);
      if (!row?.upload) throw new HttpProblem("not-found", "That document was not found.");
      if (row.status !== "received") return { status: row.status, key: row.storagePath };
      if (row.upload.completedAt || row.upload.expiresAt <= now) throw new HttpProblem("conflict", "This upload link has expired. Start a new upload.");
      if (allowance.docsUsedThisPeriod >= allowance.docsPerMonth) throw atCapacity();
      await tx.document.update({ where: { id, householdId: input.ctx.householdId }, data: { status: "scanning", storagePath: destination } });
      await tx.documentUpload.update({ where: { documentId: id }, data: { completedAt: now } });
      await tx.entitlement.update({ where: { householdId: input.ctx.householdId }, data: { periodStart: allowance.periodStart, docsUsedThisPeriod: allowance.docsUsedThisPeriod + 1 } });
      await outbox(tx).emit({ event_type: "document.uploaded", aggregate_type: "document", aggregate_id: id, household_id: input.ctx.householdId, payload: {} });
      return { status: "scanning", key: destination };
    }, { verb: "document.upload_completed" });
    if (chosen.key !== destination) {
      try { await storage.discard(destination); } catch { /* Private orphan; retention worker reconciles unselected copies. */ }
    }
    return response(chosen.status);
  });
}
