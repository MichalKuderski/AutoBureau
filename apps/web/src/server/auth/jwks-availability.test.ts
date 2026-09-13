// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createJwtVerifier, TokenError, VerificationUnavailableError } from "./jwt";

const issuer = "https://issuer.example.test";
const audience = "authenticated";
const subject = "0192f5a1-0000-7000-8000-000000000001";
let signing: CryptoKey;
let rotated: CryptoKey;
let first: JWK;
let second: JWK;
let server: Server;
let uri: string;
let requests: number;
let failures: number;
let hang: boolean;
let published: JWK[];

beforeAll(async () => {
  const a = await generateKeyPair("RS256", { extractable: true });
  const b = await generateKeyPair("RS256", { extractable: true });
  signing = a.privateKey;
  rotated = b.privateKey;
  first = { ...await exportJWK(a.publicKey), kid: "first", alg: "RS256" };
  second = { ...await exportJWK(b.publicKey), kid: "second", alg: "RS256" };
});

beforeEach(async () => {
  requests = 0;
  failures = 0;
  hang = false;
  published = [first];
  server = createServer((_req, res) => {
    requests++;
    if (hang) return;
    if (failures-- > 0) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: published }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/keys`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const verifier = () => createJwtVerifier({ jwks: { uri }, issuer, audience, algorithms: ["RS256"] });
const mint = (key = signing, kid = "first", iss = issuer) => new SignJWT({})
  .setProtectedHeader({ alg: "RS256", kid }).setIssuer(iss).setAudience(audience)
  .setSubject(subject).setExpirationTime("1h").sign(key);

describe("remote signing-key availability", () => {
  it("shares a cold fetch across separately constructed concurrent verifiers", async () => {
    const token = await mint();
    const results = await Promise.all(Array.from({ length: 8 }, () => verifier().verify(token)));
    expect(results.every(result => result.userId === subject)).toBe(true);
    expect(requests).toBe(1);
    await expect(verifier().verify(await mint(rotated))).rejects.toBeInstanceOf(TokenError);
    await expect(verifier().verify(await mint(signing, "first", "https://wrong.test"))).rejects.toMatchObject({ reason: "issuer" });
    expect(requests).toBe(1);
  });

  it("retries a failed read once and then verifies normally", async () => {
    failures = 1;
    await expect(verifier().verify(await mint())).resolves.toMatchObject({ userId: subject });
    expect(requests).toBe(2);
  });

  it("fails closed after two failures and recovers on a later request", async () => {
    failures = 2;
    const token = await mint();
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(VerificationUnavailableError);
    expect(requests).toBe(2);
    await expect(verifier().verify(token)).resolves.toMatchObject({ userId: subject });
    expect(requests).toBe(3);
  });

  it("does not reuse a trusted key set for a different configured URL", async () => {
    await verifier().verify(await mint());
    uri += "?other-config";
    failures = 2;
    await expect(verifier().verify(await mint())).rejects.toBeInstanceOf(VerificationUnavailableError);
    expect(requests).toBe(3);
  });

  it("retains unknown-key cooldown and accepts rotation after it expires", async () => {
    await verifier().verify(await mint());
    published = [second];
    const token = await mint(rotated, "second");
    await expect(verifier().verify(token)).rejects.toMatchObject({ reason: "signature" });
    expect(requests).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    await expect(verifier().verify(token)).resolves.toMatchObject({ userId: subject });
    expect(requests).toBe(2);
  });

  it("never falls back to expired cached keys during an outage", async () => {
    const token = await mint();
    await verifier().verify(token);
    failures = 2;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(VerificationUnavailableError);
    expect(requests).toBe(3);
  });

  it("bounds both attempts when the key server never answers", async () => {
    hang = true;
    await expect(verifier().verify(await mint())).rejects.toBeInstanceOf(VerificationUnavailableError);
    expect(requests).toBe(2);
  }, 15_000);
});
