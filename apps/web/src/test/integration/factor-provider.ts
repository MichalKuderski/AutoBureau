import type { IncomingMessage, ServerResponse } from "node:http";
import { decodeJwt } from "jose";
/** Synthetic provider endpoint only. Production always verifies JWTs before this
 * transport; decoding here selects fixture identity, never application authority. */
export function factorFixture(req:IncomingMessage,res:ServerResponse):boolean {
  if(req.url!=="/user")return false;
  try {
    const p=decodeJwt((req.headers.authorization??"").replace(/^Bearer /,""));
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({id:p.sub,factors:[{id:p.sub,factor_type:"totp",status:"verified"}]}));
  } catch { res.writeHead(401);res.end(); }
  return true;
}
export const assuranceFixture=(sessionId:string)=>({session_id:sessionId,aal:"aal2",amr:[{method:"totp",timestamp:Math.floor(Date.now()/1000)}]});
