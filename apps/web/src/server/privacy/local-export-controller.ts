import { ProviderError } from "../auth/provider";
import { z } from "zod";
import { requestOwnerExport, type Database } from "@autobureau/db";
import type { AuthConfig } from "../auth/config";
import { readCookie } from "../auth/context";
import { createSensitiveOperationExecutor, type SensitiveOperationPorts } from "../auth/sensitive-operation";
import { assertSameSiteRequest } from "../http/csrf";
import { jsonBody } from "../http/body";

const command=z.object({action:z.enum(["request","build","download","revoke"]),requestId:z.string().uuid()}).strict();
export interface LocalExportArtifactPort {
  build(db:Database,householdId:string,requestId:string):Promise<unknown>;
  download(db:Database,householdId:string,requestId:string):Promise<Uint8Array>;
  revoke(db:Database,householdId:string,requestId:string):Promise<unknown>;
}
/** Explicit local composition only. The vault must be local synthetic custody; no
 * environment-driven route, shared download URL, hosted key or storage activation.
 * Caller supplies a reviewed shared limiter; no in-memory/fail-open default exists.
 * Recent authentication protects BOTH data release and every DB commit in the task. */
export function createLocalExportController(config:AuthConfig,db:Database,householdId:string,
  vault:LocalExportArtifactPort,ports:SensitiveOperationPorts & {limit(request:Request,userId:string):Promise<boolean>},
  clock=()=>Math.floor(Date.now()/1000)) {
  return async(request:Request):Promise<Response>=>{
    const headers={"cache-control":"no-store, private","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
    const deny=(status:number)=>Response.json({error:"Export request could not be completed."},{status,headers});
    try {
      if(request.method!=="POST")return deny(405);
      assertSameSiteRequest(request,config);
      const token=readCookie(request.headers.get("cookie"),config.cookieName);if(!token)return deny(401);
      const value=await jsonBody(request,command,4096);
      let limited=false;
      const execute=createSensitiveOperationExecutor({...ports,admit:async(hh,principal)=>{
        if(!limited){if(!await ports.limit(request,principal.userId))throw new ExportRateLimited();limited=true;}
        return ports.admit(hh,principal);
      }},clock);
      const operation=value.action==="download"?"export.download":value.action==="revoke"?"export.revoke":"export.generate";
      const result=await execute(token,householdId,operation,async()=>{
        if(value.action==="request")return requestOwnerExport(db,householdId,value.requestId);
        return vault[value.action](db,householdId,value.requestId);
      });
      if(value.action==="download") {
        if(!(result instanceof Uint8Array) || result.byteLength>4*1024*1024)throw new Error("Export refused");
        return new Response(Uint8Array.from(result),{headers:{...headers,"content-type":"application/x-ndjson",
          "content-disposition":'attachment; filename="pellum-partial-export.jsonl"'}});
      }
      return Response.json(result,{status:value.action==="request"?202:200,headers});
    }catch(e){return deny(e instanceof ExportRateLimited?429:e instanceof ProviderError && e.reason==="unavailable"?503:403);}
  };
}
class ExportRateLimited extends Error {}
