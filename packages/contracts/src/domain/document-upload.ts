import { z } from "zod";
import { DocStatusSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 15 * 60;
export const UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "message/rfc822"] as const;
export const UploadMimeSchema = z.enum(UPLOAD_MIME_TYPES);
export type UploadMime = z.infer<typeof UploadMimeSchema>;
export const DocumentUploadInputSchema = z.object({
  filename: z.string().trim().min(1).max(255).refine((s) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127), "Use a filename without control characters."),
  mime: UploadMimeSchema, size: z.number().int().min(1).max(UPLOAD_MAX_BYTES),
}).strict();
export const DocumentUploadTicketSchema = z.object({
  document_id: UuidSchema, status: z.literal("received"), signed_url: z.string().url(),
  expires_at: IsoDateTimeSchema, method: z.literal("PUT"), headers: z.object({ "content-type": UploadMimeSchema }).strict(),
}).strict();
export const DocumentCompletionInputSchema = z.object({}).strict();
export const DocumentCompletionSchema = z.object({ document_id: UuidSchema, status: DocStatusSchema }).strict();
