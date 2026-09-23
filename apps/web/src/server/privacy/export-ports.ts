import { readAccountSecurityAdmission, runAsUser, type Database } from "@autobureau/db";
import type { AccountProvider } from "../auth/account-provider";
import type { JwtVerifier } from "../auth/jwt";
import { ProviderError } from "../auth/provider";
import { clientIpFrom, enforceRateLimit, EXPORT_POLICIES } from "../http/rate-limit";
import { traceIdFrom } from "../observability";
/** Shared PostgreSQL limiter; count the authenticated user, not request IDs or
 * household candidates. Missing ingress identity and counter outages refuse.
 * Invoke before entering the transaction-bound sensitive scope. */
export function createDatabaseExportPorts(db:Database,verifier:JwtVerifier,provider:Pick<AccountProvider,"factors">) {
  return {
    verifyJwt: (token:string)=>verifier.verify(token),
    factors: (token:string)=>provider.factors(token),
    admit: (hh:string,p:Awaited<ReturnType<JwtVerifier["verify"]>>)=>runAsUser(p.userId,()=>readAccountSecurityAdmission(db,hh,p.userId)),
    async limit(request:Request,userId:string) {
      if(clientIpFrom(request)===null)throw new ProviderError("unavailable","Export unavailable");
      const result=await enforceRateLimit({db,request,identifier:userId,policies:EXPORT_POLICIES,
        traceId:traceIdFrom(request),route:"account-export"});
      if(result?.status===503)throw new ProviderError("unavailable","Export unavailable");
      return result===null;
    },
  };
}
