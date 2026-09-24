"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";
const factor=z.object({id:z.string().uuid(),factor_type:z.literal("totp"),status:z.enum(["verified","unverified"])});
const inventory=z.object({factors:z.array(factor).max(10),level:z.enum(["aal1","aal2"]),requiresMfa:z.boolean(),lostFactorSelfService:z.literal(false)});
/** No access tokens in browser state, storage or URLs; server rotates HttpOnly cookies. */
export function SecurityPanel() {
 const [factors,setFactors]=useState<z.infer<typeof factor>[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [setup,setSetup]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[challenge,setChallenge]=useState<string|null>(null);
 const [code,setCode]=useState(""),[remove,setRemove]=useState<string|null>(null);
 const codeInput=useRef<HTMLInputElement>(null),status=useRef<HTMLParagraphElement>(null),removalTrigger=useRef<HTMLButtonElement|null>(null);
 // Focus the code field only once the verification form has actually rendered (a timer can
 // fire before React commits the form, leaving focus nowhere).
 useEffect(()=>{if(challenge)codeInput.current?.focus();},[challenge]);
 async function act(body:object,accept:(v:unknown)=>void) {
  if(busy)return;setBusy(true);setSetup(null);setMessage("");
  try {
   const response=await fetch('/v1/account/security',{method:'POST',signal:AbortSignal.timeout(30000),credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json',[CSRF_HEADER]:CSRF_HEADER_VALUE},body:JSON.stringify(body)});
   if(!response.ok)throw new Error('refused');accept(await response.json());
  }catch{setChallenge(null);setCode("");setMessage("The request could not be confirmed. Refresh the factor list before trying again.");}
  // Buttons are disabled while busy, so the one that was pressed loses focus. When nothing
  // more specific took it (the code field, the status after verification), put focus on the
  // status line that announces the outcome instead of leaving it on <body>.
  finally{setBusy(false);setTimeout(()=>{if(!document.activeElement||document.activeElement===document.body)status.current?.focus();},0);}
 }
 return <section aria-labelledby="security-heading" className="space-y-5">
  <h1 id="security-heading" className="text-2xl font-semibold">Account security</h1>
  <p>Use an authenticator to verify this session. Lost-factor reset is unavailable.</p>
  <p ref={status} role="status" aria-live="polite" tabIndex={-1}>{message}</p>
  <div className="flex flex-wrap gap-3">
   <Button disabled={busy} onClick={()=>void act({action:"list"},v=>{setFactors(inventory.parse(v).factors);setChallenge(null);setMessage("Factor list refreshed.");})}>Refresh factors</Button>
   <Button disabled={busy} onClick={()=>void act({action:"enroll"},v=>{const p=z.object({factorId:z.string().uuid(),setupSecret:z.string().regex(/^[A-Z2-7]{16,128}$/),verified:z.literal(false)}).parse(v);setSetup(p.setupSecret);setSelected(p.factorId);setFactors(fs=>[...fs,{id:p.factorId,factor_type:"totp",status:"unverified"}]);setMessage("Add this setup key to your authenticator, then request a verification code.");})}>Add authenticator</Button>
  </div>
  {setup&&<div><p>Setup key (shown once)</p><code className="break-all">{setup}</code></div>}
  <ul className="space-y-3">{factors.map((f,i)=><li key={f.id}>
   <span>Authenticator {i+1}: {f.status==="verified"?"verified":"awaiting verification"}</span>{" "}
   <Button disabled={busy} aria-label={`Request code for authenticator ${i+1}`} onClick={()=>void act({action:"challenge",factorId:f.id},v=>{const p=z.object({challengeId:z.string().uuid(),expiresAt:z.number().int()}).parse(v);setSelected(f.id);setChallenge(p.challengeId);setCode("");setMessage("Enter the code from your authenticator.");})}>Request code</Button>{" "}
   <Button disabled={busy} aria-label={`Remove authenticator ${i+1}`} onClick={e=>{removalTrigger.current=e.currentTarget;setRemove(f.id);}}>Remove</Button>
  </li>)}</ul>
  {challenge&&selected&&<form onSubmit={e=>{e.preventDefault();void act({action:"verify",factorId:selected,challengeId:challenge,code},v=>{z.object({verified:z.literal(true)}).parse(v);setChallenge(null);setCode("");setMessage("Session verified. You can return to your household.");setTimeout(()=>status.current?.focus(),0);});}}>
   <label htmlFor="totp-code">Authenticator code</label>
   <input className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-ink focus-visible:outline-2 focus-visible:outline-focus" ref={codeInput} id="totp-code" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
   <Button type="submit" disabled={busy||!/^\d{6}$/.test(code)}>Verify session</Button>
   <Button type="button" disabled={busy} onClick={()=>{setChallenge(null);setCode("");}}>Cancel verification</Button>
  </form>}
  {remove&&<div role="group" aria-label="Confirm authenticator removal">
   <p>Removing this authenticator signs you out. Removal is refused when the household requires this factor.</p>
   <Button variant="danger" className="h-auto min-h-10 whitespace-normal" disabled={busy} onClick={()=>void act({action:"remove",factorId:remove},v=>{z.object({removed:z.literal(true),signInRequired:z.literal(true)}).parse(v);setRemove(null);setFactors([]);setMessage("Authenticator removed. Sign in again.");})}>Confirm removal and sign out</Button>
   <Button variant="secondary" disabled={busy} onClick={()=>{setRemove(null);removalTrigger.current?.focus();}}>Cancel removal</Button>
  </div>}
  <a href="/dashboard">Return to household</a>{" · "}<a href="/sign-in">Sign in</a>
 </section>;
}
