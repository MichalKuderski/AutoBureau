// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRecoveryInitiator, createRecoveryController, type RecoveryPorts } from "./account-recovery";
import type { AccountProvider } from "./account-provider";
import type { VerifiedPrincipal } from "./jwt";
import type { AuthConfig } from "./config";
import { ProviderError } from "./provider";
const user = "a0000000-0000-4000-8000-000000000001", factor = "a0000000-0000-4000-8000-000000000002", session = "a0000000-0000-4000-8000-000000000003";
const config: AuthConfig = { allowedOrigins: ["https://pellum.invalid"], cookieName: "ab_session", refreshCookieName: "ab_session_refresh",
  issuer: "https://auth.invalid", audience: "authenticated", jwks: { keys: { keys: [] } }, algorithms: ["RS256"], apiUrl: "https://auth.invalid", anonKey: "public-fixture" };
const request = () => new Request("https://pellum.invalid/local-recovery", { method: "POST", headers: { origin: "https://pellum.invalid", "x-autobureau-request": "1" } });
const input = { tokenHash: "synthetic-single-use-hash", password: "synthetic-only-strong-password" };
function setup(mfa = false) {
  let redeemed = false, now=2000;
  const principal: VerifiedPrincipal = { userId: user, email: undefined, issuedAt: 2000, expiresAt: 5000, assurance: { sessionId: session, level: "aal1", methods: [{ method: "recovery", timestamp: 2000 }] } };
  const elevated: VerifiedPrincipal = { ...principal, assurance: { sessionId: session, level: "aal2", methods: [{ method: "totp", timestamp: 2000 }] } };
  const provider: AccountProvider = {
    factors: vi.fn().mockResolvedValue({ userId: user, factors: mfa ? [{ id: factor, factor_type: "totp", status: "verified" }] : [] }),
    enroll: vi.fn(), remove: vi.fn(), challenge: vi.fn().mockResolvedValue({ id: factor, expiresAt: 2300 }),
    verify: vi.fn().mockResolvedValue({ accessToken: "elevated", refreshToken: "rotated", expiresIn: 3600 }),
    recover: vi.fn().mockResolvedValue(undefined),
    redeemRecovery: vi.fn(async () => { if (redeemed) throw new ProviderError("invalid-code", "safe"); redeemed = true; return { accessToken: "recovery", refreshToken: "refresh", expiresIn: 3600 }; }),
    updatePassword: vi.fn().mockResolvedValue({ userId: user }), revoke: vi.fn().mockResolvedValue(undefined),
  };
  const ports: RecoveryPorts = { verifyJwt: vi.fn(async t => t === "elevated" ? elevated : principal), limit: vi.fn().mockResolvedValue(true),
    passwordAllowed: vi.fn().mockResolvedValue(true), admit: vi.fn().mockResolvedValue(undefined), audit: vi.fn().mockResolvedValue(undefined) };
  return { provider, ports, principal, elevated, advance:(n:number)=>{now+=n;}, controller: createRecoveryController(config, provider, ports, () => now) };
}
describe("unmounted server recovery", () => {
  it.each([undefined,"invalid-code","invalid-credentials","rate-limited"] as const)("same 202 for account-dependent result %s", async reason => {
    const f = setup(); if (reason) vi.mocked(f.provider.recover).mockRejectedValue(new ProviderError(reason, "safe"));
    const r = await f.controller.initiate(request(), { email: "synthetic@example.invalid" });
    expect(r.status).toBe(202); expect(await r.json()).toEqual({ status: "If the address can recover an account, instructions will be sent." });
    expect(r.headers.getSetCookie()).toHaveLength(0);
  });
  it("upstream outage remains 503; one request only", async () => {
    const f = setup(); vi.mocked(f.provider.recover).mockRejectedValue(new ProviderError("unavailable", "safe", 504));
    expect((await f.controller.initiate(request(), { email: "synthetic@example.invalid" })).status).toBe(503); expect(f.provider.recover).toHaveBeenCalledTimes(1);
  });
  it("initiation limiter runs before provider and cannot depend on account existence", async () => {
    const f = setup(); vi.mocked(f.ports.limit).mockResolvedValue(false);
    expect((await f.controller.initiate(request(), { email: "synthetic@example.invalid" })).status).toBe(429); expect(f.provider.recover).not.toHaveBeenCalled();
  });
  it("one recovery grant changes password, audits phases, revokes refresh sessions and requires new login", async () => {
    const f = setup(); const r = await f.controller.complete(request(), input);
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ passwordChanged: true, signInRequired: true, accessTokensMayRemainValidUntilExpiry: true });
    expect(r.headers.getSetCookie().every(c => c.includes("Max-Age=0"))).toBe(true);
    expect(f.ports.audit).toHaveBeenNthCalledWith(1, f.principal, "attempted", expect.objectContaining({ principal: f.principal }));
    expect(f.ports.audit).toHaveBeenNthCalledWith(2, f.principal, "password-acknowledged", expect.objectContaining({ principal: f.principal }));
    expect(f.ports.audit).toHaveBeenNthCalledWith(3, f.principal, "revocation-acknowledged", expect.objectContaining({ principal: f.principal }));
    expect(f.provider.updatePassword).toHaveBeenCalledWith("recovery", input.password);
  });
  it("MFA account must prove its existing factor and same session before password mutation", async () => {
    const f = setup(true); expect((await f.controller.complete(request(), { ...input, factorId: factor, code: "123456" })).status).toBe(200);
    expect(f.provider.updatePassword).toHaveBeenCalledWith("elevated", input.password); expect(f.provider.remove).not.toHaveBeenCalled(); expect(f.provider.enroll).not.toHaveBeenCalled();
  });
  it.each(["csrf","foreign-origin","get","schema","weak-password","policy-unavailable","limit","bad-jwt","stale-token","expired","wrong-user","account-fenced","audit-unavailable"])("refuses %s before password mutation", async control => {
    const f = setup(); let req = request();
    if (control === "csrf") req.headers.delete("x-autobureau-request");
    if (control === "foreign-origin") req.headers.set("origin", "https://hostile.invalid");
    if (control === "get") req = new Request(req.url);
    if (control === "weak-password") vi.mocked(f.ports.passwordAllowed).mockResolvedValue(false);
    if (control === "policy-unavailable") vi.mocked(f.ports.passwordAllowed).mockRejectedValue(new Error("unavailable"));
    if (control === "limit") vi.mocked(f.ports.limit).mockResolvedValue(false);
    if (control === "bad-jwt") vi.mocked(f.ports.verifyJwt).mockRejectedValue(new Error("bad"));
    if (control === "stale-token") Object.assign(f.principal, { issuedAt: 1990 });
    if (control === "expired") Object.assign(f.principal, { expiresAt: 2000 });
    if (control === "wrong-user") vi.mocked(f.provider.factors).mockResolvedValue({ userId: factor, factors: [] });
    if (control === "account-fenced") vi.mocked(f.ports.admit).mockRejectedValue(new Error("fenced"));
    if (control === "audit-unavailable") vi.mocked(f.ports.audit).mockRejectedValue(new Error("unavailable"));
    const r = await f.controller.complete(req, { ...input, ...(control === "schema" ? { metadata: { authorized: true } } : {}) });
    expect(r.status).toBe(control === "limit" ? 429 : 403); expect(f.provider.updatePassword).not.toHaveBeenCalled();
  });
  it.each(["missing-factor","wrong-factor","wrong-user","wrong-session","aal1","stale-totp","future-totp","expired-challenge"])("recovery cannot bypass MFA with %s", async control => {
    const f = setup(true);
    if (control === "wrong-user") Object.assign(f.elevated, { userId: factor });
    if (control === "wrong-session") f.elevated.assurance!.sessionId = factor;
    if (control === "aal1") f.elevated.assurance!.level = "aal1";
    if (control === "stale-totp") f.elevated.assurance!.methods[0]!.timestamp = 1900;
    if (control === "future-totp") f.elevated.assurance!.methods[0]!.timestamp = 2001;
    if (control === "expired-challenge") vi.mocked(f.provider.challenge).mockResolvedValue({ id: factor, expiresAt: 2000 });
    const value = control === "missing-factor" ? input : { ...input, factorId: control === "wrong-factor" ? user : factor, code: "123456" };
    expect((await f.controller.complete(request(), value)).status).toBe(403); expect(f.provider.updatePassword).not.toHaveBeenCalled();
  });
  it("replayed hash cannot change password again", async () => {
    const f = setup(); expect((await f.controller.complete(request(), input)).status).toBe(200);
    expect((await f.controller.complete(request(), input)).status).toBe(403); expect(f.provider.updatePassword).toHaveBeenCalledTimes(1);
  });
  it.each(["password","revocation","audit"])("ambiguous %s outcome clears cookies and never retries", async control => {
    const f = setup();
    if (control === "password") vi.mocked(f.provider.updatePassword).mockRejectedValue(new ProviderError("unavailable", "safe", 504));
    if (control === "revocation") vi.mocked(f.provider.revoke).mockRejectedValue(new ProviderError("unavailable", "safe", 504));
    if (control === "audit") vi.mocked(f.ports.audit).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("unavailable"));
    const r = await f.controller.complete(request(), input);
    expect(r.status).toBe(control === "audit" ? 403 : 503); expect(r.headers.getSetCookie().every(c => c.includes("Max-Age=0"))).toBe(true);
    expect(f.provider.updatePassword).toHaveBeenCalledTimes(1); expect(f.provider.revoke).toHaveBeenCalledTimes(control === "revocation" ? 1 : 0);
    expect(await r.text()).not.toContain(input.password);
  });
});
it.each(["removed","foreign-user","new-factor","provider-unavailable"])("refuses changed factor state before password update: %s",async mode=>{
 const f=setup(mode!=="new-factor");
 const original=await f.provider.factors("fixture");vi.mocked(f.provider.factors).mockClear();
 vi.mocked(f.provider.factors).mockResolvedValueOnce(original);
 if(mode==="provider-unavailable")vi.mocked(f.provider.factors).mockRejectedValueOnce(new ProviderError("unavailable","safe"));
 else vi.mocked(f.provider.factors).mockResolvedValueOnce({userId:mode==="foreign-user"?session:user,factors:mode==="new-factor"?[{id:factor,factor_type:"totp",status:"verified"}]:[]});
 const body=mode==="new-factor"?input:{...input,factorId:factor,code:"123456"};
 expect((await f.controller.complete(request(),body)).status).toBe(mode==="provider-unavailable"?503:403);
 expect(f.provider.updatePassword).not.toHaveBeenCalled();expect(f.provider.redeemRecovery).toHaveBeenCalledTimes(1);
});
it("initiation counter outage is coarse 503 without contacting provider",async()=>{
 const f=setup();vi.mocked(f.ports.limit).mockRejectedValue(new ProviderError("unavailable","safe"));expect((await f.controller.initiate(request(),{email:"synthetic@example.test"})).status).toBe(503);expect(f.provider.recover).not.toHaveBeenCalled();
});

it.each(["slow-factor-read", "slow-audit", "expired-session"])("recovery refuses stale pre-mutation evidence: %s",async mode=>{
 const f=setup();
 if(mode==="slow-factor-read")vi.mocked(f.provider.factors).mockImplementation(async()=>{f.advance(61);return {userId:user,factors:[]};});
 else vi.mocked(f.ports.audit).mockImplementation(async()=>{f.advance(mode==="slow-audit"?61:3001);});
 expect((await f.controller.complete(request(),input)).status).toBe(403);expect(f.provider.updatePassword).not.toHaveBeenCalled();
});
it("public initiation composes without a candidate household, verifier or account admission",async()=>{
 const recover=vi.fn().mockResolvedValue(undefined),limit=vi.fn().mockResolvedValue(true);
 const initiate=createRecoveryInitiator(config,{recover},{limit});
 expect((await initiate(request(),{email:"public@example.invalid"})).status).toBe(202);
 expect(recover).toHaveBeenCalledExactlyOnceWith("public@example.invalid");
});
