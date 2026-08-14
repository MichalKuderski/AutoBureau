// @vitest-environment node
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet, type JWK } from "jose";
import { createJwtVerifier, TokenError, VerifierConfigError } from "./jwt";

/**
 * ADR-009 A17 — "valid token verifies; invalid signature, expired, wrong issuer, wrong
 * audience, unpinned algorithm, and malformed claims each fail."
 *
 * Every token here is minted with real keys and verified through the shipped module.
 * Nothing is stubbed, and no Supabase project is involved: the point of a
 * provider-agnostic verifier is that it can be proved without one.
 */

const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const SUBJECT = "0192f5a1-0000-7000-8000-000000000001";

let signingKey: CryptoKey;
let jwks: JSONWebKeySet;
let foreignKey: CryptoKey;
let esKey: CryptoKey;

async function keyToJwk(key: CryptoKey, kid: string, alg: string): Promise<JWK> {
  return { ...(await exportJWK(key)), kid, alg, use: "sig" };
}

beforeAll(async () => {
  const rsa = await generateKeyPair("RS256", { extractable: true });
  const foreign = await generateKeyPair("RS256", { extractable: true });
  const ec = await generateKeyPair("ES256", { extractable: true });

  signingKey = rsa.privateKey;
  foreignKey = foreign.privateKey;
  esKey = ec.privateKey;

  // The published set contains the real key and the EC key, but NOT the foreign key —
  // so a foreign-signed token fails on the signature rather than on key lookup.
  jwks = {
    keys: [await keyToJwk(rsa.publicKey, "rsa-1", "RS256"), await keyToJwk(ec.publicKey, "ec-1", "ES256")],
  };
});

const verifier = () =>
  createJwtVerifier({ jwks: { keys: jwks }, issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] });

interface TokenOverrides {
  issuer?: string | undefined;
  audience?: string | undefined;
  subject?: string | null | undefined;
  expiresIn?: string | number | null | undefined;
  key?: CryptoKey | undefined;
  alg?: string | undefined;
  kid?: string | undefined;
}

async function mint(overrides: TokenOverrides = {}): Promise<string> {
  const alg = overrides.alg ?? "RS256";
  let jwt = new SignJWT({}).setProtectedHeader({ alg, kid: overrides.kid ?? "rsa-1" }).setIssuedAt();

  jwt = jwt.setIssuer(overrides.issuer ?? ISSUER).setAudience(overrides.audience ?? AUDIENCE);
  if (overrides.subject !== null) jwt = jwt.setSubject(overrides.subject ?? SUBJECT);
  if (overrides.expiresIn !== null) jwt = jwt.setExpirationTime(overrides.expiresIn ?? "1h");

  return jwt.sign(overrides.key ?? signingKey);
}

/** Asserts the rejection reason without depending on message wording. */
async function expectRejection(token: string, reason: string): Promise<TokenError> {
  const error = await verifier()
    .verify(token)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(error, "expected verification to fail").toBeInstanceOf(TokenError);
  expect((error as TokenError).reason).toBe(reason);
  return error as TokenError;
}

describe("A17 · a valid token verifies", () => {
  it("returns the subject as the user id", async () => {
    const principal = await verifier().verify(await mint());
    expect(principal.userId).toBe(SUBJECT);
    expect(principal.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(principal.issuedAt).toBeTypeOf("number");
  });

  it("normalises an uppercase subject rather than rejecting it", async () => {
    const principal = await verifier().verify(await mint({ subject: SUBJECT.toUpperCase() }));
    expect(principal.userId).toBe(SUBJECT);
  });
});

describe("A17 · signature", () => {
  it("rejects a token signed by a key outside the JWKS", async () => {
    await expectRejection(await mint({ key: foreignKey }), "signature");
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const [header, , signature] = (await mint()).split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: SUBJECT, iss: ISSUER, aud: AUDIENCE, exp: 4102444800 }),
    ).toString("base64url");
    await expectRejection(`${header}.${forged}.${signature}`, "signature");
  });

  it("rejects a token referencing an unknown key id", async () => {
    await expectRejection(await mint({ kid: "does-not-exist" }), "signature");
  });
});

describe("A17 · expiry", () => {
  it("rejects an expired token", async () => {
    await expectRejection(await mint({ expiresIn: Math.floor(Date.now() / 1000) - 60 }), "expired");
  });

  it("rejects a token with no expiry at all", async () => {
    // jose validates `exp` only when present; without an explicit check a token that
    // omits it would verify forever.
    await expectRejection(await mint({ expiresIn: null }), "claims");
  });

  it("honours a configured clock tolerance", async () => {
    const justExpired = await mint({ expiresIn: Math.floor(Date.now() / 1000) - 10 });
    await expectRejection(justExpired, "expired");

    const tolerant = createJwtVerifier({
      jwks: { keys: jwks },
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
      clockToleranceSec: 60,
    });
    await expect(tolerant.verify(justExpired)).resolves.toMatchObject({ userId: SUBJECT });
  });
});

describe("A17 · issuer and audience", () => {
  it("rejects a foreign issuer", async () => {
    await expectRejection(await mint({ issuer: "https://evil.example.test" }), "issuer");
  });

  it("rejects a token minted for a different audience", async () => {
    await expectRejection(await mint({ audience: "some-other-app" }), "audience");
  });
});

describe("A17 · algorithm pinning", () => {
  it("rejects an algorithm outside the allowlist even when the key is published", async () => {
    // The EC public key IS in the JWKS, so this fails on the pin, not on key lookup.
    await expectRejection(await mint({ alg: "ES256", kid: "ec-1", key: esKey }), "algorithm");
  });

  it("accepts that algorithm once it is pinned", async () => {
    const es = createJwtVerifier({
      jwks: { keys: jwks },
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["ES256"],
    });
    const principal = await es.verify(await mint({ alg: "ES256", kid: "ec-1", key: esKey }));
    expect(principal.userId).toBe(SUBJECT);
  });

  it("refuses to build a verifier that would accept a symmetric algorithm", () => {
    // Algorithm confusion: an attacker HMACs the token with the published public key.
    expect(() =>
      createJwtVerifier({
        jwks: { keys: jwks },
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      }),
    ).toThrow(VerifierConfigError);
  });

  it("refuses `none`", () => {
    expect(() =>
      createJwtVerifier({ jwks: { keys: jwks }, issuer: ISSUER, audience: AUDIENCE, algorithms: ["none"] }),
    ).toThrow(VerifierConfigError);
  });
});

describe("A17 · malformed claims and tokens", () => {
  it("rejects a token with no subject", async () => {
    await expectRejection(await mint({ subject: null }), "claims");
  });

  it("rejects a subject that is not a user id", async () => {
    await expectRejection(await mint({ subject: "not-a-uuid" }), "claims");
    await expectRejection(await mint({ subject: "12345" }), "claims");
  });

  it.each([
    ["empty string", ""],
    ["not a jwt", "hello-there"],
    ["two segments", "aaa.bbb"],
    ["garbage segments", "aaa.bbb.ccc"],
  ])("rejects %s as malformed", async (_label, token) => {
    await expectRejection(token, "malformed");
  });

  it("never echoes the token back in the error", async () => {
    const token = await mint({ issuer: "https://evil.example.test" });
    const error = await expectRejection(token, "issuer");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("evil.example.test");
  });
});

describe("configuration fails at construction, not at verification", () => {
  it.each([
    ["no issuer", { issuer: "" }],
    ["no audience", { audience: "" }],
    ["no algorithms", { algorithms: [] as string[] }],
  ])("rejects %s", (_label, patch) => {
    expect(() =>
      createJwtVerifier({
        jwks: { keys: jwks },
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["RS256"],
        ...patch,
      }),
    ).toThrow(VerifierConfigError);
  });

  it("rejects an empty key set and an empty jwks uri", () => {
    expect(() =>
      createJwtVerifier({
        jwks: { keys: { keys: [] } },
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["RS256"],
      }),
    ).toThrow(VerifierConfigError);
    expect(() =>
      createJwtVerifier({ jwks: { uri: "" }, issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"] }),
    ).toThrow(VerifierConfigError);
  });
});

describe("the production key path resolves over JWKS", () => {
  let server: Server;
  let uri: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/jwks.json`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("verifies a token using keys fetched from the endpoint", async () => {
    // createRemoteJWKSet is the production path; a local HTTP server exercises it
    // without inventing a provider.
    const remote = createJwtVerifier({
      jwks: { uri },
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    });
    const principal = await remote.verify(await mint());
    expect(principal.userId).toBe(SUBJECT);

    // And it still rejects — the remote path is not a bypass.
    await expect(remote.verify(await mint({ key: foreignKey }))).rejects.toBeInstanceOf(TokenError);
  });
});
