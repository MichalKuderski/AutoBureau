/** Local synthetic mount only. No flag can turn this into a hosted/provider path (the
 * hosted mount in account-mount.ts has its own, separate gate). Refuse before DB/provider construction. Explicit loopback endpoints prevent a
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
