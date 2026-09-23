// @vitest-environment node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "vitest";
import type { AuthConfig } from "./config";
import { createGoTrueProvider, ProviderError, providerFailureMeta, type AuthProvider } from "./provider";
import { MAX_PROVIDER_RESPONSE_BYTES } from "./provider-body";

const config: AuthConfig = {
  issuer: "https://auth.example.test", audience: "autobureau",
  jwks: { uri: "https://auth.example.test/jwks.json" },
  cookieName: "ab_session", refreshCookieName: "ab_session_refresh",
  apiUrl: "https://auth.example.test", anonKey: "synthetic-anon-key",
  allowedOrigins: ["https://app.autobureau.test"], algorithms: ["RS256"],
};
const ID = "11111111-1111-4111-8111-111111111111";
const CANARY = "PRIVATE_RESPONSE_CANARY";
const TOKENS = { access_token: "at", refresh_token: "rt", expires_in: 3600 };
const FLOWS = ["signup", "password", "refresh", "pkce", "confirmation", "magic", "logout"] as const;
type Flow = (typeof FLOWS)[number];
function invoke(provider: AuthProvider, flow: Flow): Promise<unknown> {
  switch (flow) {
    case "signup": return provider.signUp("synthetic@example.test", CANARY, "Synthetic");
    case "password": return provider.signInWithPassword("synthetic@example.test", CANARY);
    case "refresh": return provider.refresh(CANARY);
    case "pkce": return provider.exchangeCode(CANARY, CANARY);
    case "confirmation": return provider.verifyEmailToken(CANARY, "signup");
    case "magic": return provider.requestMagicLink("synthetic@example.test", CANARY, "https://app.autobureau.test/auth/callback");
    case "logout": return provider.signOut(CANARY);
  }
}
const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "sb-request-id": ID } });

async function unavailableOnce(response: Response, flow: Flow = "signup", timeoutMs = 10_000): Promise<void> {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return response; };
  await assert.rejects(invoke(createGoTrueProvider(config, fetchImpl, timeoutMs), flow), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.reason, "unavailable");
    assert.equal("cause" in error, false);
    assert.ok(!JSON.stringify(error).includes(CANARY));
    assert.ok(!JSON.stringify(providerFailureMeta(error)).includes(CANARY));
    assert.ok(!String(error).includes(CANARY));
    return true;
  });
  assert.equal(calls, 1);
}

describe("signup must have positive response-shape evidence", () => {
  const invalid: Array<[string, unknown]> = [
    ["null", null], ["empty object", {}], ["array", []], ["string", CANARY],
    ["number", 7], ["boolean", true], ["error object", { error: CANARY }],
    ["invalid user id", { id: CANARY }],
    ["incomplete tokens", { access_token: CANARY }],
    ["bare user with partial tokens", { id: ID, access_token: CANARY }],
    ["bare user with null refresh", { id: ID, refresh_token: null }],
    ["bare user with invalid lifetime", { id: ID, expires_in: 0 }],
    ["full tokens with invalid lifetime", { ...TOKENS, expires_in: -1 }],
  ];
  for (const [name, body] of invalid) {
    it(`refuses ${name}, rather than manufacturing confirmation-required`, async () => {
      await unavailableOnce(json(body));
    });
  }
  it("refuses HTML success bodies", async () => {
    await unavailableOnce(new Response(`<html>${CANARY}</html>`));
  });
  it("refuses empty 204 responses", async () => {
    await unavailableOnce(new Response(null, { status: 204 }));
  });
  it("still accepts a session while discarding unneeded user metadata", async () => {
    const fetchImpl: typeof fetch = async () => json({ ...TOKENS, user: { id: ID, user_metadata: { private: CANARY } } });
    assert.deepEqual(await createGoTrueProvider(config, fetchImpl).signUp("synthetic@example.test", CANARY, "Synthetic"), {
      kind: "session", tokens: { accessToken: "at", refreshToken: "rt", expiresIn: 3600 },
    });
  });
  it("treats genuine pending and obfuscated duplicate users identically", async () => {
    for (const body of [
      { id: ID, email: "synthetic@example.test", identities: [{ id: ID }], confirmation_sent_at: "2026-09-19T00:00:00Z" },
      { id: ID, email: "different@example.test", identities: [] },
      { id: ID },
    ]) {
      const fetchImpl: typeof fetch = async () => json(body);
      assert.deepEqual(await createGoTrueProvider(config, fetchImpl).signUp("synthetic@example.test", CANARY, "Synthetic"), { kind: "confirmation-required" });
    }
  });
  it("keeps one allow-listed diagnostic for unusable bodies", async () => {
    const fetchImpl: typeof fetch = async () => json({ error: CANARY });
    await assert.rejects(createGoTrueProvider(config, fetchImpl).signUp("synthetic@example.test", CANARY, "Synthetic"), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.httpStatus, 200);
      assert.equal(error.diagnostics?.failure, "invalid-response");
      assert.equal(error.diagnostics?.requestId, ID);
      assert.equal(typeof error.diagnostics?.durationMs, "number");
      return true;
    });
  });
});

describe("all token-bearing flows share the bounded reader", () => {
  for (const flow of FLOWS.filter((value) => value !== "magic" && value !== "logout")) {
    it(`${flow}: a stalled 200 body is unavailable, never success`, async () => {
      let calls = 0;
      let cancelled = false;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('{"access_token":"')); },
          cancel() { cancelled = true; },
        }));
      };
      const provider = createGoTrueProvider(config, fetchImpl, 30);
      await assert.rejects(invoke(provider, flow), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, "unavailable");
        assert.equal(error.httpStatus, 200);
        assert.equal(error.diagnostics?.failure, "timeout");
        return true;
      });
      assert.equal(calls, 1);
      assert.equal(cancelled, true);
    });
    it(`${flow}: even syntactically valid oversized token bodies are refused`, async () => {
      await unavailableOnce(json({ ...TOKENS, padding: "a".repeat(MAX_PROVIDER_RESPONSE_BYTES) }), flow);
    });
  }
});

describe("credentials never follow provider redirects", () => {
  for (const flow of FLOWS) {
    it(`${flow}: one real HTTP request, no request to the redirect target`, async () => {
      const paths: string[] = [];
      const server = createServer((req, res) => {
        paths.push(req.url ?? "");
        if (req.url === "/sink") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(TOKENS));
        } else {
          res.writeHead(307, { location: "/sink" });
          res.end();
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const request = invoke(createGoTrueProvider({ ...config, apiUrl }), flow);
        if (flow === "logout") await request; // Local logout must remain best-effort.
        else await assert.rejects(request, { reason: "unavailable", httpStatus: 307 });
        assert.equal(paths.length, 1);
        assert.ok(!paths.includes("/sink"));
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
    it(`${flow}: opts out of caching and redirect following before sending credentials`, async () => {
      let init: RequestInit | undefined;
      const fetchImpl: typeof fetch = async (_url, requestInit) => { init = requestInit; return json(TOKENS); };
      await invoke(createGoTrueProvider(config, fetchImpl), flow);
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.cache, "no-store");
    });
  }
});

describe("unused successful bodies are released", () => {
  for (const flow of ["magic", "logout"] as const) {
    it(`${flow} cancels its body without attempting to interpret it`, async () => {
      let cancelled = false;
      const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
      }));
      await invoke(createGoTrueProvider(config, fetchImpl), flow);
      assert.equal(cancelled, true);
    });
  }
});

describe("refusals and ambiguous outcomes never cause credential replay", () => {
  for (const flow of ["signup","password","refresh","pkce","confirmation","magic"] as const) {
    for (const status of [400,401,403,422,429,500,502,503,504]) {
      it(`${flow} classifies HTTP ${status}, makes one request and releases its body`, async()=>{
        let calls=0, cancelled=false;
        const fetchImpl:typeof fetch=async()=>{calls++;return new Response(new ReadableStream<Uint8Array>({
          start(controller){controller.enqueue(new TextEncoder().encode(CANARY));},
          cancel(){cancelled=true;},
        }),{status});};
        const expected=status===429 ? "rate-limited" : status>=500 ? "unavailable"
          : flow==="refresh" ? "invalid-refresh" : flow==="pkce" || flow==="confirmation" ? "invalid-code" : "invalid-credentials";
        await assert.rejects(invoke(createGoTrueProvider(config,fetchImpl),flow),(error:unknown)=>{
          assert.ok(error instanceof ProviderError);assert.equal(error.reason,expected);
          assert.equal(error.httpStatus,status);assert.ok(!JSON.stringify(error).includes(CANARY));return true;
        });
        assert.equal(calls,1);assert.equal(cancelled,true);
      });
    }
  }
  it("allows only an explicit later retry, with no replay inside the failed request",async()=>{
    let calls=0;
    const fetchImpl:typeof fetch=async()=>++calls===1?new Response(null,{status:504}):json(TOKENS);
    const provider=createGoTrueProvider(config,fetchImpl);
    await assert.rejects(provider.signInWithPassword('synthetic@example.test',CANARY),{reason:'unavailable'});
    assert.equal(calls,1);
    assert.deepEqual(await provider.signInWithPassword('synthetic@example.test',CANARY),{accessToken:'at',refreshToken:'rt',expiresIn:3600});
    assert.equal(calls,2);
  });
  it("discards unsafe diagnostic request-id strings",async()=>{
    const fetchImpl:typeof fetch=async()=>new Response(CANARY,{status:504,headers:{'sb-request-id':CANARY}});
    await assert.rejects(createGoTrueProvider(config,fetchImpl).refresh(CANARY),(error:unknown)=>{
      assert.ok(error instanceof ProviderError);assert.equal(error.diagnostics?.requestId,undefined);
      assert.ok(!JSON.stringify(providerFailureMeta(error)).includes(CANARY));return true;
    });
  });
});
