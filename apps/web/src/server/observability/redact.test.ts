// @vitest-environment node
//
// The server runtime, because several of these assertions are about `Request`, `Headers`
// and `Buffer` — types whose DOM equivalents behave differently enough that a happy-dom
// pass would prove something other than what ships.
import { describe, expect, it } from "vitest";
import { REDACTED, describeError, isSensitiveKey, redactMeta, redactValue, scrubString } from "./redact";

/**
 * Doc 10 §3: "log-scrubber unit tests are part of the platform module."
 *
 * Written as leak attempts rather than happy paths. The only interesting question about a
 * redaction boundary is what gets past it, so every case below is a value that must not
 * survive, placed somewhere a careless caller would plausibly put it.
 */

/** Shaped like the real thing — a three-segment base64url JWT beginning `eyJ`. */
const JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiIwMTkyZjVhMS0wMDAwLTcwMDAtODAwMCJ9.c2lnbmF0dXJlLXZhbHVlLXRoYXQtaXMtbG9uZw";
const REFRESH = "v1.MTo4YWZmZGE2Zi1mNzhiLTQ5ZGUtOTk4Yi1kZjc3NmU5NGRlZGM";

function serialised(value: unknown): string {
  return JSON.stringify(redactValue(value));
}

// ─────────────────────────── Test B · direct sensitive values ───────────────────────────

describe("Test B · credential-bearing keys never survive", () => {
  it.each([
    "authorization",
    "Authorization",
    "cookie",
    "set-cookie",
    "setCookie",
    "token",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "ACCESS-TOKEN",
    "csrf",
    "csrfToken",
    "pkce",
    "verifier",
    "codeVerifier",
    "code_challenge",
    "secret",
    "client_secret",
    "item_secrets",
    "password",
    "apiKey",
    "api_key",
    "anonKey",
    "ciphertext",
    "signature",
    "email",
  ])("%s is recognised as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    ["authorization", `Bearer ${JWT}`],
    ["cookie", `ab_session=${JWT}; ab_session_refresh=${REFRESH}`],
    ["accessToken", JWT],
    ["refresh_token", REFRESH],
    ["csrfToken", "1"],
    ["apiKey", "sk_live_51H8xQ2eZvKYlo2C"],
    ["password", "correct-horse-battery-staple"],
    ["client_secret", "whsec_abc123def456"],
  ])("a %s value is replaced, not merely hidden", (key, value) => {
    const out = serialised({ [key]: value });
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(value);
  });

  it("redacts the key even when the value looks harmless", () => {
    expect(redactValue({ password: "" })).toEqual({ password: REDACTED });
  });

  it("does not redact ordinary diagnostic keys", () => {
    expect(redactValue({ route: "/v1/households/current", status: 500 })).toEqual({
      route: "/v1/households/current",
      status: 500,
    });
  });
});

// ─────────────────────────── Test C · nested and awkward shapes ───────────────────────────

describe("Test C · nesting does not launder a secret", () => {
  it("redacts a token buried three levels down", () => {
    const out = serialised({
      request: { context: { session: { accessToken: JWT } } },
    });
    expect(out).not.toContain(JWT);
    expect(out).toContain(REDACTED);
  });

  it("redacts sensitive keys inside arrays of objects", () => {
    const out = serialised({ attempts: [{ password: "hunter2" }, { cookie: `s=${JWT}` }] });
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain(JWT);
  });

  it("scrubs a JWT that was stored under an innocent key", () => {
    // The key filter cannot help here; the value filter must.
    const out = serialised({ note: `the request carried ${JWT} in its cookie` });
    expect(out).not.toContain(JWT);
    expect(out).toContain(REDACTED);
  });

  it("stops at a depth cap rather than walking an arbitrary graph", () => {
    const deep = { a: { b: { c: { d: { e: { secretValue: JWT } } } } } };
    const out = serialised(deep);
    expect(out).not.toContain(JWT);
    expect(out).toContain("[truncated]");
  });

  it("survives a cycle without hanging", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    expect(() => serialised(cyclic)).not.toThrow();
  });

  it("caps a large array instead of emitting all of it", () => {
    const out = redactValue({ items: Array.from({ length: 100 }, (_, i) => i) }) as {
      items: unknown[];
    };
    expect(out.items.length).toBeLessThanOrEqual(21);
    expect(out.items.at(-1)).toContain("more");
  });

  it("drops prototype-polluting keys entirely", () => {
    // `JSON.parse` produces `__proto__` as a real own property, and `Object.entries`
    // yields it — so the filter has to skip it explicitly. Asserted with `hasOwn`
    // because reading `out["__proto__"]` returns the prototype rather than the key.
    const out = redactValue(JSON.parse('{"__proto__": {"admin": true}, "ok": 1}')) as
      Record<string, unknown>;
    expect(Object.hasOwn(out, "__proto__")).toBe(false);
    expect(out["ok"]).toBe(1);
  });
});

// ───────────────── Test D · provider bodies and unserialisable types ─────────────────

describe("Test D · a provider response never reaches a record", () => {
  it("refuses to serialise a Response object", () => {
    const providerBody = JSON.stringify({ access_token: JWT, refresh_token: REFRESH });
    const response = new Response(providerBody, { status: 400 });
    const out = serialised({ providerResponse: response });
    expect(out).toBe(JSON.stringify({ providerResponse: "[Response]" }));
    expect(out).not.toContain(JWT);
  });

  it("refuses to serialise a Request object", () => {
    const request = new Request("https://app.autobureau.com/v1/auth/sign-in", {
      method: "POST",
      headers: { authorization: `Bearer ${JWT}`, cookie: `ab_session=${JWT}` },
    });
    const out = serialised({ request });
    expect(out).not.toContain(JWT);
    expect(out).toContain("[Request]");
  });

  it("refuses to serialise a Headers bag", () => {
    const headers = new Headers({ authorization: `Bearer ${JWT}` });
    expect(serialised({ headers })).not.toContain(JWT);
  });

  it("reduces binary to a length — the shape item_secrets.ciphertext arrives in", () => {
    const ciphertext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(redactValue({ ciphertext: ciphertext })).toEqual({ ciphertext: REDACTED });
    // Even under a non-sensitive key it becomes a marker rather than a byte dump.
    expect(redactValue({ payload: ciphertext })).toEqual({ payload: "[binary 8B]" });
  });

  it("scrubs a parsed provider body that reached a metadata bag", () => {
    // The realistic accident: someone `JSON.parse`s the provider response and logs it.
    const parsed = { access_token: JWT, refresh_token: REFRESH, expires_in: 3600 };
    const out = serialised({ providerBody: parsed });
    expect(out).not.toContain(JWT);
    expect(out).not.toContain(REFRESH);
    expect(out).toContain("3600");
  });
});

// ─────────────────────────── value-shape scrubbing ───────────────────────────

describe("value-shape scrubbing catches what key names cannot", () => {
  it("redacts a bearer header found in free text", () => {
    expect(scrubString(`sent Authorization: Bearer ${JWT}`)).not.toContain(JWT);
  });

  it("redacts a database connection string", () => {
    const dsn = "postgresql://app_user:hunter2@127.0.0.1:5432/autobureau";
    const out = scrubString(`connect failed for ${dsn}`);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("app_user");
  });

  it("redacts an email address, which doc 10 §3 forbids in logs", () => {
    const out = scrubString("Unique constraint failed: alice@example.com already exists");
    expect(out).not.toContain("alice@example.com");
    expect(out).toContain("[redacted-email]");
  });

  it("strips credentials and query strings from a URL", () => {
    const url = new URL("https://user:pw@auth.example.test/v1/token?code=abc123");
    const out = String(redactValue(url));
    expect(out).not.toContain("pw");
    expect(out).not.toContain("abc123");
  });

  it("leaves ordinary text and version strings intact", () => {
    expect(scrubString("prisma 6.19.3 failed on route /v1/households/current")).toBe(
      "prisma 6.19.3 failed on route /v1/households/current",
    );
  });

  it("truncates a very long string rather than emitting it whole", () => {
    expect(scrubString("x".repeat(5000))).toContain("[truncated]");
  });
});

// ─────────────────────────── describeError ───────────────────────────

describe("describeError extracts named fields rather than serialising the error", () => {
  it("keeps the constructor name and a scrubbed message", () => {
    const described = describeError(new TypeError("bad token eyJhbGciOi.aaaaaaaa.bbbbbbbb"));
    expect(described.kind).toBe("TypeError");
    expect(described.message).not.toContain("eyJhbGciOi.aaaaaaaa.bbbbbbbb");
  });

  it("carries a Prisma error code but not the conflicting value", () => {
    const prismaish = Object.assign(new Error("Unique constraint failed on `users_email_key`"), {
      code: "P2002",
      meta: { target: ["email"] },
    });
    const described = describeError(prismaish);
    expect(described.code).toBe("P2002");
    expect(described.message).toContain("Unique constraint failed");
  });

  it("carries this codebase's `reason` enums as the error code", () => {
    const withReason = Object.assign(new Error("session is not valid"), { reason: "expired" });
    expect(describeError(withReason).code).toBe("expired");
  });

  it("refuses a code that is not identifier-shaped", () => {
    const hostile = Object.assign(new Error("x"), { code: `stack\ninjected ${JWT}` });
    expect(describeError(hostile).code).toBeUndefined();
  });

  it("omits the stack unless it is asked for, and scrubs it when it is", () => {
    const error = new Error(`failed for alice@example.com`);
    expect(describeError(error).stack).toBeUndefined();
    const withStack = describeError(error, { stack: true });
    expect(withStack.stack).toBeDefined();
    expect(withStack.stack).not.toContain("alice@example.com");
  });

  it("handles a thrown non-Error without throwing itself", () => {
    expect(describeError(`token ${JWT}`).kind).toBe("NonError");
    expect(describeError(`token ${JWT}`).message).not.toContain(JWT);
  });
});

describe("redactMeta always yields an object", () => {
  it("returns {} when handed something that is not a bag", () => {
    expect(redactMeta([1, 2, 3] as unknown as Record<string, unknown>)).toEqual({});
  });
});
