// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAccountSecurityController, type AccountSecurityPorts, type ChallengeBinding } from "./account-security";
import type { AccountProvider } from "./account-provider";
import type { AuthConfig } from "./config";
import type { VerifiedPrincipal } from "./jwt";
import { createLocalAccountRoutes } from "./local-account-routes";
import { ProviderError } from "./provider";
const user = "a0000000-0000-4000-8000-000000000001", factor = "a0000000-0000-4000-8000-000000000002";
const session = "a0000000-0000-4000-8000-000000000003", challenge = "a0000000-0000-4000-8000-000000000004";
const config = { allowedOrigins: ["https://pellum.invalid"], cookieName: "ab_session", refreshCookieName: "ab_session_refresh", issuer: "https://auth.invalid", audience: "authenticated", jwks: { keys: { keys: [] } }, algorithms: ["RS256"], apiUrl: "https://auth.invalid/auth/v1", anonKey: "public-fixture" } satisfies AuthConfig;
const request = () => new Request("https://pellum.invalid/local-only", { method: "POST", headers: { origin: "https://pellum.invalid", "x-autobureau-request": "1" } });
function setup() {
  let now = 2000;
  const principal: VerifiedPrincipal = { userId: user, email: undefined, issuedAt: 2000, expiresAt: 5000, assurance: { sessionId: session, level: "aal1", methods: [{ method: "password", timestamp: now }] } };
  const elevated: VerifiedPrincipal = { ...principal, assurance: { sessionId: session, level: "aal2", methods: [{ method: "totp", timestamp: now }] } };
  const provider: AccountProvider = {
    factors: vi.fn().mockResolvedValue({ userId: user, factors: [{ id: factor, factor_type: "totp", status: "verified" }] }),
    enroll: vi.fn().mockResolvedValue({ id: factor, secret: "A".repeat(32) }),
    challenge: vi.fn().mockResolvedValue({ id: challenge, expiresAt: now + 300 }),
    verify: vi.fn().mockResolvedValue({ accessToken: "elevated.access", refreshToken: "elevated.refresh", expiresIn: 3600 }),
    remove: vi.fn().mockResolvedValue(undefined), recover: vi.fn(), redeemRecovery: vi.fn(), updatePassword: vi.fn(), revoke: vi.fn().mockResolvedValue(undefined),
  };
  // Explicit in-memory fixture only. The controller cannot supply a default store.
  const journal = new Map<string, ChallengeBinding>();
  const ports: AccountSecurityPorts = {
    verifyJwt: vi.fn(async token => token === "elevated.access" ? elevated : principal),
    admit: vi.fn().mockResolvedValue({ requiresMfa: false }), audit: vi.fn().mockResolvedValue(undefined),
    challenges: {
      put: vi.fn(async b => { if (journal.has(b.challengeId)) throw new Error("duplicate"); journal.set(b.challengeId, b); }),
      consume: vi.fn(async (b, at) => { const stored = journal.get(b.challengeId); if (!stored || stored.expiresAt <= at || stored.userId !== b.userId || stored.sessionId !== b.sessionId || stored.factorId !== b.factorId) return false; journal.delete(b.challengeId); return true; }),
    },
  };
  const handle = createAccountSecurityController(config, provider, ports, () => now);
  return { principal, elevated, provider, ports, journal, handle, advance: (n: number) => { now += n; } };
}
describe("unmounted server MFA lifecycle", () => {
  it("lists projected state without session or metadata", async () => {
    const f = setup(); const r = await f.handle(request(), "access", { action: "list" });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ level: "aal1", lostFactorSelfService: false });
    expect(r.headers.get("cache-control")).toContain("no-store"); expect(f.provider.enroll).not.toHaveBeenCalled();
  });
  it("enrolls only after recent password and before/after audit", async () => {
    const f = setup(); vi.mocked(f.provider.factors).mockResolvedValue({ userId: user, factors: [] });
    expect((await f.handle(request(), "access", { action: "enroll" })).status).toBe(200);
    expect(f.ports.audit).toHaveBeenNthCalledWith(1, f.principal, "enroll", "attempted", expect.objectContaining({ principal: f.principal }));
    expect(f.ports.audit).toHaveBeenNthCalledWith(2, f.principal, "enroll", "acknowledged", expect.objectContaining({ principal: f.principal }));
  });
  it("verifies same-user same-session fresh aal2, rotates both cookies, no token body", async () => {
    const f = setup(); expect((await f.handle(request(), "access", { action: "challenge", factorId: factor })).status).toBe(200);
    const r = await f.handle(request(), "access", { action: "verify", factorId: factor, challengeId: challenge, code: "123456" });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ verified: true });
    const cookies = r.headers.getSetCookie(); expect(cookies).toHaveLength(2);
    for (const c of cookies) { expect(c).toContain("HttpOnly; Secure; SameSite=Lax"); }
    expect(cookies.join()).toContain("elevated.refresh");
    expect(f.ports.admit).toHaveBeenCalledTimes(5);
  });
  it.each(["csrf", "origin", "method", "body", "session", "expired", "rate", "audit", "owner", "factor-owner"]) ("denies %s before provider mutation", async control => {
    const f = setup(); let req = request();
    if (control === "csrf") req.headers.delete("x-autobureau-request");
    if (control === "origin") req.headers.set("origin", "https://hostile.invalid");
    if (control === "method") req = new Request(req.url);
    if (control === "session") Object.assign(f.principal, { assurance: undefined });
    if (control === "expired") Object.assign(f.principal, { expiresAt: 1999 });
    if (control === "rate" || control === "owner") vi.mocked(f.ports.admit).mockRejectedValue(new Error("refuse"));
    if (control === "audit") vi.mocked(f.ports.audit).mockRejectedValue(new Error("refuse"));
    if (control === "factor-owner") vi.mocked(f.provider.factors).mockResolvedValue({ userId: factor, factors: [] });
    const r = await f.handle(req, "access", { action: "challenge", factorId: factor, ...(control === "body" ? { admin: true } : {}) });
    expect(r.status).toBe(403); expect(f.provider.challenge).not.toHaveBeenCalled();
  });
  it.each(["stale-password", "verified-mfa-aal1", "recovery-only", "refresh-only"]) ("refuses enrollment from %s", async control => {
    const f = setup();
    if (control !== "verified-mfa-aal1") vi.mocked(f.provider.factors).mockResolvedValue({ userId: user, factors: [] });
    f.principal.assurance!.methods[0] = { method: control === "recovery-only" ? "recovery" : control === "refresh-only" ? "token_refresh" : "password", timestamp: control === "stale-password" ? 1000 : 2000 };
    expect((await f.handle(request(), "access", { action: "enroll" })).status).toBe(403); expect(f.provider.enroll).not.toHaveBeenCalled();
  });
  it.each(["wrong-user", "wrong-session", "aal1", "stale-totp", "future-totp", "factor-not-verified", "post-fence", "post-audit"]) ("refuses rotated session with %s and clears local cookies", async control => {
    const f = setup(); await f.handle(request(), "access", { action: "challenge", factorId: factor });
    if (control === "wrong-user") Object.assign(f.elevated, { userId: factor });
    if (control === "wrong-session") f.elevated.assurance!.sessionId = factor;
    if (control === "aal1") f.elevated.assurance!.level = "aal1";
    if (control === "stale-totp") f.elevated.assurance!.methods[0]!.timestamp = 1990;
    if (control === "future-totp") f.elevated.assurance!.methods[0]!.timestamp = 2001;
    if (control === "factor-not-verified") vi.mocked(f.provider.factors).mockResolvedValueOnce({ userId: user, factors: [{ id: factor, factor_type: "totp", status: "verified" }] }).mockResolvedValueOnce({ userId: user, factors: [] });
    if (control === "post-fence") vi.mocked(f.ports.admit).mockResolvedValueOnce({ requiresMfa: false }).mockResolvedValueOnce({ requiresMfa: false }).mockRejectedValueOnce(new Error("fenced"));
    if (control === "post-audit") vi.mocked(f.ports.audit).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("unavailable"));
    const r = await f.handle(request(), "access", { action: "verify", factorId: factor, challengeId: challenge, code: "123456" });
    expect(r.status).toBe(403); expect(r.headers.getSetCookie()).toHaveLength(2);
    expect(r.headers.getSetCookie().every(c => c.includes("Max-Age=0"))).toBe(true);
  });
  it.each(["replay", "expired", "different-session", "missing"]) ("refuses challenge %s", async control => {
    const f = setup(); await f.handle(request(), "access", { action: "challenge", factorId: factor });
    const value = { action: "verify", factorId: factor, challengeId: challenge, code: "123456" };
    if (control === "replay") await f.handle(request(), "access", value);
    if (control === "expired") f.advance(300);
    if (control === "different-session") f.journal.set(challenge, { ...f.journal.get(challenge)!, sessionId: factor });
    if (control === "missing") f.journal.clear();
    vi.mocked(f.provider.verify).mockClear();
    expect((await f.handle(request(), "access", value)).status).toBe(403); expect(f.provider.verify).not.toHaveBeenCalled();
  });
  it("concurrent challenge consumption calls the provider once", async () => {
    const f = setup(); await f.handle(request(), "access", { action: "challenge", factorId: factor });
    const value = { action: "verify", factorId: factor, challengeId: challenge, code: "123456" };
    const responses = await Promise.all([f.handle(request(), "access", value), f.handle(request(), "access", value)]);
    expect(responses.map(r => r.status).sort()).toEqual([200,403]); expect(f.provider.verify).toHaveBeenCalledTimes(1);
  });
  it("provider 504 remains 503 and never retries a consumed challenge", async () => {
    const f = setup(); await f.handle(request(), "access", { action: "challenge", factorId: factor });
    vi.mocked(f.provider.verify).mockRejectedValue(new ProviderError("unavailable", "safe", 504));
    const value = { action: "verify", factorId: factor, challengeId: challenge, code: "123456" };
    expect((await f.handle(request(), "access", value)).status).toBe(503);
    expect((await f.handle(request(), "access", value)).status).toBe(403); expect(f.provider.verify).toHaveBeenCalledTimes(1);
  });
  it("refuses any verified-factor removal when MFA required, including two-factor race", async () => {
    const f = setup(); Object.assign(f.principal, f.elevated);
    vi.mocked(f.ports.admit).mockResolvedValue({ requiresMfa: true });
    vi.mocked(f.provider.factors).mockResolvedValue({ userId: user, factors: [factor, challenge].map(id => ({ id, factor_type: "totp", status: "verified" })) });
    expect((await f.handle(request(), "access", { action: "remove", factorId: factor })).status).toBe(403); expect(f.provider.remove).not.toHaveBeenCalled();
  });
  it("removal clears session and acknowledges refresh revocation, not immediate JWT invalidation", async () => {
    const f = setup(); Object.assign(f.principal, f.elevated);
    const r = await f.handle(request(), "access", { action: "remove", factorId: factor });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ signInRequired: true, accessTokensMayRemainValidUntilExpiry: true });
    expect(f.provider.revoke).toHaveBeenCalledTimes(1); expect(r.headers.getSetCookie().every(c => c.includes("Max-Age=0"))).toBe(true);
  });
});

it.each(["slow-factors", "slow-audit", "expired-after-audit", "malformed-factors", "duplicate-factors"])("refuses MFA evidence race: %s", async mode => {
 const f=setup(); vi.mocked(f.provider.factors).mockResolvedValue({userId:user,factors:[]});
 if(mode==="slow-factors")vi.mocked(f.provider.factors).mockImplementation(async()=>{f.advance(61);return{userId:user,factors:[]};});
 if(mode==="slow-audit"||mode==="expired-after-audit")vi.mocked(f.ports.audit).mockImplementation(async()=>{f.advance(mode==="slow-audit"?61:3001);});
 if(mode==="malformed-factors")vi.mocked(f.provider.factors).mockResolvedValue({userId:user,factors:[{id:factor,factor_type:"totp",status:"unknown" as never}]});
 if(mode==="duplicate-factors")vi.mocked(f.provider.factors).mockResolvedValue({userId:user,factors:[factor,factor].map(id=>({id,factor_type:"totp",status:"unverified"}))});
 expect((await f.handle(request(),"access",{action:"enroll"})).status).toBe(403);
 expect(f.provider.enroll).not.toHaveBeenCalled();
});
it.each(["valid", "missing-cookie", "stale", "csrf", "oversize", "unknown-path", "get"])("local HTTP security boundary invokes real central policy: %s",async mode=>{
 const f=setup();vi.mocked(f.provider.factors).mockResolvedValue({userId:user,factors:[]});
 if(mode==="stale")f.principal.assurance!.methods[0]!.timestamp=1000;
 const recovery=vi.fn();const route=createLocalAccountRoutes(config,{security:f.handle,initiate:recovery,complete:recovery});
 const headers=new Headers({origin:"https://pellum.invalid","x-autobureau-request":"1","content-type":"application/json",cookie:"ab_session=access"});
 if(mode==="missing-cookie")headers.delete("cookie");if(mode==="csrf")headers.delete("x-autobureau-request");
 const req=new Request(`https://pellum.invalid/${mode==="unknown-path"?"unknown":"v1/account/security"}`,{method:mode==="get"?"GET":"POST",headers,
 ...(mode==="get"?{}:{body:JSON.stringify(mode==="oversize"?{action:"enroll",extra:"x".repeat(5000)}:{action:"enroll"})})});
 const r=await route(req);expect(r.status).toBe(mode==="valid"?200:mode==="get"?405:mode==="unknown-path"?404:mode==="missing-cookie"?401:403);
 expect(f.provider.enroll).toHaveBeenCalledTimes(mode==="valid"?1:0);expect(recovery).not.toHaveBeenCalled();
 if(mode==="valid")expect(f.ports.audit).toHaveBeenCalledWith(f.principal,"enroll","attempted",expect.objectContaining({checkedAt:2000}));
});
