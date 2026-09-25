import { createPasswordPolicy } from "./password-policy";
import { CsrfError, assertSameSiteRequest } from "../http/csrf";
import { ProviderError } from "./provider";
import { z } from "zod";
import { getDatabase } from "../db";
import { authConfigFromEnv } from "./config";
import { createJwtVerifier } from "./jwt";
import { RequestContextError, membershipsVia, resolveRequestContext } from "./context";
import { createAccountProvider } from "./account-provider";
import { createAccountSecurityController } from "./account-security";
import { createDatabaseAccountSecurityPorts } from "./account-security-ports";
import { createRecoveryController, createRecoveryInitiator, type RecoveryPorts } from "./account-recovery";
import { createDatabaseRecoveryPorts, createDatabaseRecoveryInitiationPorts } from "./account-recovery-ports";
import { createLocalAccountRoutes } from "./local-account-routes";

/** Local synthetic mount only. No flag can turn this into a hosted/provider path.
 * Refuse before DB/provider construction. Explicit loopback endpoints prevent a
 * preview accidentally using ambient staging credentials. Never log these URLs. */
export function assertLocalAccountMount(env:Readonly<Record<string,string|undefined>>):void {
  const loopback=(raw:string|undefined,...protocols:string[])=>{
    if(!raw)throw new Error("Local account mount unavailable");
    const u=new URL(raw);
    if(!protocols.includes(u.protocol)||u.hostname!=="127.0.0.1"||u.search||u.hash)throw new Error("Local account mount unavailable");
    return u;
  };
  if(env.NODE_ENV==="production"||env.VERCEL||env.AWS_EXECUTION_ENV||env.LOCAL_ACCOUNT_ROUTES!=="synthetic-only")throw new Error("Local account mount unavailable");
  loopback(env.AUTH_API_URL,"http:"); loopback(env.AUTH_JWKS_URL,"http:");
  // The browser origin may be loopback TLS: session cookies are Secure unconditionally, and
  // WebKit on macOS stores no Secure cookie over plain-http loopback. Still 127.0.0.1 only.
  loopback(env.APP_ORIGIN,"http:","https:");
  const db=loopback(env.DATABASE_URL,"postgresql:");
  if(db.username!=="app_user"||!db.pathname.startsWith("/pellum_"))throw new Error("Local account mount unavailable");
}
export async function localAccountMount(request:Request):Promise<Response> {
  const denied=(status:number)=>Response.json({error:"Local account operation is unavailable."},{status,
    headers:{"cache-control":"no-store, private","referrer-policy":"no-referrer"}});
  try {
    assertLocalAccountMount(process.env);
    const config=authConfigFromEnv();
    if(request.method!=="POST")return denied(405);
    assertSameSiteRequest(request,config);
    const db=getDatabase(),verifier=createJwtVerifier(config),provider=createAccountProvider(config);
    const unavailable=async()=>denied(404);
    let security=unavailable as ReturnType<typeof createAccountSecurityController>;
    let complete=unavailable as ReturnType<typeof createRecoveryController>["complete"];
    const path=new URL(request.url).pathname;
    if(path==="/v1/account/security") {
      const ctx=await resolveRequestContext(request,{verifier,memberships:membershipsVia(db),cookieName:config.cookieName});
      security=createAccountSecurityController(config,provider,createDatabaseAccountSecurityPorts(db,ctx.householdId,verifier));
    }
    if(path==="/v1/auth/recovery/complete") {
      // A recovery token, once redeemed, establishes the principal. Household
      // selection is resolved from that identity, never a pre-redemption browser ID.
      let selected:ReturnType<typeof createDatabaseRecoveryPorts>|undefined;
      const requireSelected=()=>{if(!selected)throw new Error("Recovery refused");return selected;};
      const ports:RecoveryPorts={
        ...createDatabaseRecoveryInitiationPorts(db,request),
        async verifyJwt(token){
          const p=await verifier.verify(token),memberships=await membershipsVia(db)(p.userId);
          const candidate=request.headers.get("x-household-id");
          if(candidate!==null&&!z.string().uuid().safeParse(candidate).success)throw new Error("Recovery refused");
          const member=candidate ? memberships.find(m=>m.householdId===candidate) : memberships.length===1 ? memberships[0] : undefined;
          if(!member||member.role!=="owner")throw new Error("Recovery refused");
          selected=createDatabaseRecoveryPorts(db,member.householdId,request,verifier);
          return p;
        },
        // Local mount intentionally refuses external breach-corpus traffic. The
        // reviewed local fixture must provide the same bounded password contract.
        async passwordAllowed(password) {
          const policy=createPasswordPolicy(async(input,init)=>{
            const u=new URL(String(input));
            if(u.origin!=="https://api.pwnedpasswords.com"||!/^\/range\/[A-F0-9]{5}$/.test(u.pathname))throw new Error("Breach fixture refused");
            return fetch(new URL(u.pathname,config.apiUrl),init);
          });
          const verdict=await policy(password);
          if(verdict==="unavailable")throw new ProviderError("unavailable","Local breach fixture unavailable");
          return verdict==="allowed";
        },
        admit:(...args)=>requireSelected().admit(...args),
        audit:(...args)=>requireSelected().audit(...args),
      };
      complete=createRecoveryController(config,provider,ports).complete;
    }
    const initiate=createRecoveryInitiator(config,provider,createDatabaseRecoveryInitiationPorts(db,request));
    return createLocalAccountRoutes(config,{security,initiate,complete})(request);
  }catch(e){return denied(e instanceof CsrfError?403:e instanceof RequestContextError?e.status:503);}
}
