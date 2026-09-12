import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "./database";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";

/** Real JWT/JWKS and app_user boundary; admin is only for disposable fixtures/assertions. */
export async function domainHarness() {
  await assertExpectedServer();
  await grantAppUserLogin();
  const admin = adminClient();
  const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const household = randomUUID(), foreignHousehold = randomUUID();
  await admin.user.createMany({ data: [owner, viewer, outsider].map((id) => ({ id, email: `${id}@example.test` })) });
  await admin.userProfile.createMany({ data: [owner, viewer, outsider].map((userId) => ({ userId, displayName: userId === owner ? "Owner" : "Other person" })) });
  await admin.household.createMany({ data: [
    { id: household, name: "Our household", createdBy: owner },
    { id: foreignHousehold, name: "Foreign household", createdBy: outsider },
  ] });
  await admin.householdUser.createMany({ data: [
    { householdId: household, userId: owner, role: "owner" },
    { householdId: household, userId: viewer, role: "viewer" },
    { householdId: foreignHousehold, userId: outsider, role: "owner" },
  ] });
  const issuer = "https://auth.example.test/v1", origin = "https://app.example.test";
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "domain-test", alg: "RS256", use: "sig" }] };
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(jwks)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  Object.assign(process.env, { AUTH_ISSUER: issuer, AUTH_AUDIENCE: "autobureau", AUTH_COOKIE_NAME: "ab_session",
    AUTH_JWKS_URL: `http://127.0.0.1:${port}/jwks`, AUTH_API_URL: `http://127.0.0.1:${port}`,
    AUTH_ANON_KEY: "unused-local-test-key", APP_ORIGIN: origin });
  return {
    admin, owner, viewer, outsider, household, foreignHousehold,
    async request(path: string, options: { method?: string; body?: unknown; user?: string | null; headers?: Record<string, string>; rawBody?: string } = {}) {
      const { method = "GET", user = owner } = options;
      const jwt = user === null ? null : await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "domain-test" }).setSubject(user)
        .setIssuer(issuer).setAudience("autobureau").setIssuedAt().setExpirationTime("1h").sign(privateKey);
      return new Request(`${origin}${path}`, { method, headers: {
        origin, [CSRF_HEADER]: CSRF_HEADER_VALUE,
        ...(jwt ? { cookie: `ab_session=${jwt}` } : {}),
        ...(options.body !== undefined || options.rawBody !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      }, ...(options.rawBody !== undefined ? { body: options.rawBody } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    },
    async close() {
      await admin.auditLog.deleteMany({ where: { householdId: { in: [household, foreignHousehold] } } });
      await admin.idempotencyKey.deleteMany({ where: { householdId: { in: [household, foreignHousehold] } } });
      await admin.household.deleteMany({ where: { id: { in: [household, foreignHousehold] } } });
      await admin.user.deleteMany({ where: { id: { in: [owner, viewer, outsider] } } });
      await admin.$disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
