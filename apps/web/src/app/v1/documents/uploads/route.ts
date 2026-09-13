import { authenticated } from "@/server/http/route";
import { createDocumentUpload } from "@/server/domain/document-upload";
export const POST = authenticated({ requires: "document.upload" }, createDocumentUpload);
export const dynamic = "force-dynamic";
