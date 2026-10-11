import { z } from "zod";
/** Closed categories only: no document contents or free-text reasons in the journal. */
export const DocumentRejectionReasonSchema = z.enum(["incorrect-reading", "wrong-document", "duplicate", "not-needed", "other"]);
export type DocumentRejectionReason = z.infer<typeof DocumentRejectionReasonSchema>;
export const DOCUMENT_REJECTION_LABELS: Record<DocumentRejectionReason, string> = {
  "incorrect-reading": "The reading is incorrect",
  "wrong-document": "This is the wrong document",
  duplicate: "I already have this information",
  "not-needed": "I do not need this reading",
  other: "Another reason",
};
