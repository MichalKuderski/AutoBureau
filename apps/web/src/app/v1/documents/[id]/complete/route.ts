import { authenticated } from "@/server/http/route";
import { completeDocumentUpload } from "@/server/domain/document-upload";
export const POST = authenticated({ requires: "document.upload" }, completeDocumentUpload);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
