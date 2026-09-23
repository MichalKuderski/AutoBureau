// @vitest-environment node
import { expect, it } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createJwtVerifier, type VerifiedPrincipal } from "./jwt";
import { projectAccountAssurance, requireRecentAccountAuth } from "./recent-auth";

const now = 1_790_000_000, userId = "a0000000-0000-4000-8000-000000000001", sessionId = "b0000000-0000-4000-8000-000000000001";
function fixture() {
  const principal: VerifiedPrincipal = { userId, email: undefined, issuedAt: now, expiresAt: now + 600,
    assurance: { sessionId, level: "aal1", methods: [{ method: "password", timestamp: now - 60 }] } };
  const factors = { userId, sessionId, checkedAt: now, verifiedTotp: false };
  return { principal, factors };
}
it("accepts a recent password with fresh independently supplied factor evidence", () => {
  const f = fixture(); expect(requireRecentAccountAuth(f.principal, f.factors, now)).toEqual({ authorized: true, expiresAt: now + 600, sessionRevocationVerified: false });
});
it("requires recent TOTP and aal2 when a verified factor exists", () => {
  const f = fixture(); f.factors.verifiedTotp = true;
  expect(() => requireRecentAccountAuth(f.principal, f.factors, now)).toThrow();
  f.principal.assurance!.level = "aal2";
  expect(() => requireRecentAccountAuth(f.principal, f.factors, now)).toThrow();
  f.principal.assurance!.methods.push({ method: "totp", timestamp: now - 20 });
  expect(requireRecentAccountAuth(f.principal, f.factors, now).authorized).toBe(true);
});
it.each(["token_refresh", "recovery", "magiclink", "otp", "email/signup", "unknown"])("refuses %s as sensitive-operation step-up", method => {
  const f = fixture(); f.principal.assurance!.methods = [{ method, timestamp: now }];
  expect(() => requireRecentAccountAuth(f.principal, f.factors, now)).toThrow();
});
it.each(["missing", "malformed", "stale", "future", "different-user", "different-session", "extra"])("refuses %s factor evidence", mode => {
  const f = fixture(); let factors: unknown = f.factors;
  if (mode === "missing") factors = undefined;
  if (mode === "malformed") factors = { ...f.factors, verifiedTotp: "false" };
  if (mode === "stale") f.factors.checkedAt -= 61;
  if (mode === "future") f.factors.checkedAt += 1;
  if (mode === "different-user") f.factors.userId = sessionId;
  if (mode === "different-session") f.factors.sessionId = userId;
  if (mode === "extra") factors = { ...f.factors, metadata: "private" };
  expect(() => requireRecentAccountAuth(f.principal, factors, now)).toThrow("Recent account authentication is required");
});
it("does not mistake a newly refreshed iat for recent password authentication", () => {
  const f = fixture(); f.principal.assurance!.methods[0]!.timestamp = now - 900;
  expect(() => requireRecentAccountAuth(f.principal, f.factors, now)).toThrow();
});
it.each(["future", "expired", "duplicate", "unknown-aal", "missing", "non-integer-clock", "contradictory-mfa"])("refuses %s assurance", mode => {
  const f = fixture(); let time = now;
  if (mode === "future") f.principal.assurance!.methods[0]!.timestamp = now + 1;
  if (mode === "expired") Object.assign(f.principal, { expiresAt: now });
  if (mode === "duplicate") f.principal.assurance!.methods.push(f.principal.assurance!.methods[0]!);
  if (mode === "unknown-aal") f.principal.assurance!.level = "aal3" as never;
  if (mode === "missing") delete (f.principal as { assurance?: unknown }).assurance;
  if (mode === "non-integer-clock") time += 0.1;
  if (mode === "contradictory-mfa") f.principal.assurance!.level = "aal2";
  expect(() => requireRecentAccountAuth(f.principal, f.factors, time)).toThrow();
});
it("projects only top-level verified claims; metadata cannot create authority", () => {
  expect(projectAccountAssurance({ user_metadata: { aal: "aal2", session_id: sessionId, amr: [{ method: "totp", timestamp: now }] } })).toEqual({});
  expect(projectAccountAssurance({ aal: "aal1", session_id: sessionId, amr: Array(17).fill({ method: "password", timestamp: now }) })).toEqual({});
});
it("obtains assurance through actual signature verification and refuses forgery", async () => {
  const pair = await generateKeyPair("ES256"), jwk = await exportJWK(pair.publicKey);
  const verifier = createJwtVerifier({ issuer: "https://auth.example.test", audience: "authenticated", algorithms: ["ES256"], jwks: { keys: { keys: [jwk] } } });
  const token = await new SignJWT({ aal: "aal2", session_id: sessionId, amr: [{ method: "totp", timestamp: now }] })
    .setProtectedHeader({ alg: "ES256" }).setSubject(userId).setIssuer("https://auth.example.test").setAudience("authenticated").setExpirationTime("1h").sign(pair.privateKey);
  expect((await verifier.verify(token)).assurance).toMatchObject({ level: "aal2", sessionId });
  const parts = token.split("."); parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1]!, "base64url").toString()), sub: sessionId })).toString("base64url");
  await expect(verifier.verify(parts.join("."))).rejects.toThrow();
});
