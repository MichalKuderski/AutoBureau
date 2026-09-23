import { parseCanonicalPublicPdf, redactParsedDocument } from '../services/ai/src/redaction.js';
import { classifyWithLocalStub } from '../services/ai/src/gateway.js';

/** LOCAL public fixtures only. No injected model/provider, filename, OCR metadata,
 * secret resolver or network client. Source identity is checked again by SQL. */
export function prepareLocalDocumentResult(bytes:Uint8Array,identity:{id:string;processingId:string;leaseToken:string}) {
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>4096)throw new Error('Local result refused');
 const snapshot=Buffer.from(bytes);
 const safe=redactParsedDocument(parseCanonicalPublicPdf({bytes:snapshot,format:'application/pdf'}));
 const verdict=classifyWithLocalStub(safe.capability);
 if(verdict.providerCalled||verdict.status!=='requires-human-review')throw new Error('Local result refused');
 return Object.freeze({id:identity.id,processingId:identity.processingId,leaseToken:identity.leaseToken,
  sourceSha256:safe.provenance.sourceSha256,citationStart:safe.provenance.citation.start,citationEnd:safe.provenance.citation.end,
  dueDate:snapshot.subarray(safe.provenance.citation.start,safe.provenance.citation.end).toString('ascii')});
}
