// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "./config";
import { createGoTrueProvider, ProviderError } from "./provider";

/**
 * `provider.signUp` (blueprint P1-02).
 *
 * The property under test is the one that makes this endpoint safe to expose publicly:
 * **the shape of the answer must not depend on whether the address already has an
 * account.** GoTrue signals "already registered" by returning a 2xx obfuscated user with no
 * token set — the same shape as a genuine confirmation-pending signup — and by a 4xx when
 * confirmations are off. Both must land on `confirmation-required` or a `ProviderError`
 * that the route renders identically, or sign-up becomes a membership oracle.
 *
 * Kept in its own file rather than appended to `provider.test.ts`: that file's scope note
 * fixes it at P1-06 timeout behaviour, and widening it in place would make its own header
 * false.
 */

const config: AuthConfig = {
  issuer: "https://auth.example.test",
  audience: "autobureau",
  jwks: { uri: "https://auth.example.test/jwks.json" },
  cookieName: "ab_session",
  refreshCookieName: "ab_session_refresh",
  apiUrl: "https://auth.example.test",
  anonKey: "anon-key",
  allowedOrigins: ["https://app.autobureau.test"],
  algorithms: ["RS256"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** What GoTrue returns when "Confirm email" is OFF: a full token set. */
const SESSION_BODY = {
  access_token: "at",
  refresh_token: "rt",
  expires_in: 3600,
  user: { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.test" },
};

/** What it returns when confirmation is ON — and, notably, for an address already taken. */
const PENDING_BODY = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.test",
  confirmation_sent_at: "2026-09-03T00:00:00Z",
  identities: [],
};

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response.clone()) as unknown as typeof fetch;
}

describe("signUp — the deployment's confirmation setting decides, not this code", () => {
  it("returns a session when the provider issued one", async () => {
    const provider = createGoTrueProvider(config, fetchReturning(jsonResponse(SESSION_BODY)));

    const outcome = await provider.signUp("ada@example.test", "correct horse battery", "Ada");

    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    expect(outcome.tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("returns confirmation-required when the provider issued no token set", async () => {
    const provider = createGoTrueProvider(config, fetchReturning(jsonResponse(PENDING_BODY)));

    const outcome = await provider.signUp("ada@example.test", "correct horse battery", "Ada");

    expect(outcome.kind).toBe("confirmation-required");
  });

  it("posts to /signup with the anon key and carries the name as user metadata", async () => {
    const fetchImpl = fetchReturning(jsonResponse(PENDING_BODY));
    const provider = createGoTrueProvider(config, fetchImpl);

    await provider.signUp("ada@example.test", "correct horse battery", "Ada");

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://auth.example.test/signup");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).apikey).toBe("anon-key");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "ada@example.test",
      password: "correct horse battery",
      data: { display_name: "Ada" },
    });
  });

  it("attaches a bounded AbortSignal, like every other provider call", async () => {
    const fetchImpl = fetchReturning(jsonResponse(PENDING_BODY));
    const provider = createGoTrueProvider(config, fetchImpl);

    await provider.signUp("ada@example.test", "correct horse battery", "Ada");

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("signUp — no account-enumeration oracle", () => {
  it("an already-registered address is indistinguishable from a fresh one (confirmations ON)", async () => {
    // GoTrue's obfuscated-user response. Byte-identical handling to a real new signup is
    // the entire point: if this arm ever diverged, the endpoint would report membership.
    const provider = createGoTrueProvider(config, fetchReturning(jsonResponse(PENDING_BODY)));

    const outcome = await provider.signUp("taken@example.test", "correct horse battery", "Ada");

    expect(outcome).toEqual({ kind: "confirmation-required" });
  });

  it("a 422 refusal surfaces as a classified error carrying no provider text", async () => {
    const provider = createGoTrueProvider(
      config,
      fetchReturning(jsonResponse({ msg: "User already registered" }, 422)),
    );

    const error = await provider
      .signUp("taken@example.test", "correct horse battery", "Ada")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    // The provider's own wording distinguishes "already registered" from "weak password".
    // It must not reach the caller — the route turns this into the same 202 a fresh
    // address gets, and it could not do that if the message leaked the distinction.
    expect((error as ProviderError).message).not.toMatch(/registered/i);
    expect((error as ProviderError).message).toBe("sign-up was refused");
  });

  /*
   * The half this file used to leave unasserted, and the half that was broken.
   *
   * Checking only the message let a real oracle through: `mapStatus` had no case for 422,
   * so GoTrue's `422 user_already_exists` — its answer to every repeat sign-up — classified
   * as `unavailable`, and the route returned 503 where a fresh address returned 204. The
   * wording never leaked and the endpoint reported membership anyway, by status code.
   *
   * Staging caught it: 204 → 503 → 503 across three attempts on one address. So the
   * classification is asserted here, and the reason is spelled out rather than left to a
   * comment, because it is the property the 202 depends on.
   */
  it("classifies a 422 as a fact about the ACCOUNT, so the route can answer 202", async () => {
    const provider = createGoTrueProvider(
      config,
      fetchReturning(jsonResponse({ msg: "User already registered", error_code: "user_already_exists" }, 422)),
    );

    const error = await provider
      .signUp("taken@example.test", "correct horse battery", "Ada")
      .catch((e: unknown) => e);

    expect((error as ProviderError).reason).toBe("invalid-credentials");
    // Never `unavailable`: that is the deployment-fault class and becomes a 503, which a
    // fresh address never receives.
    expect((error as ProviderError).reason).not.toBe("unavailable");
  });

  it("still treats a genuine provider outage as a deployment fault", async () => {
    // The counterpart. 5xx must stay `unavailable` — widening the account-fact class to
    // swallow real outages would trade one wrong answer for another.
    for (const status of [500, 502, 503]) {
      const provider = createGoTrueProvider(config, fetchReturning(jsonResponse({}, status)));
      const error = await provider
        .signUp("someone@example.test", "correct horse battery", "Ada")
        .catch((e: unknown) => e);
      expect((error as ProviderError).reason).toBe("unavailable");
    }
  });
});

describe("signUp — failure classification matches the rest of the provider", () => {
  it("classifies 429 as rate-limited", async () => {
    const provider = createGoTrueProvider(config, fetchReturning(jsonResponse({}, 429)));

    const error = await provider
      .signUp("ada@example.test", "correct horse battery", "Ada")
      .catch((e: unknown) => e);

    expect((error as ProviderError).reason).toBe("rate-limited");
  });

  it("classifies a 500 as unavailable", async () => {
    const provider = createGoTrueProvider(config, fetchReturning(jsonResponse({}, 500)));

    const error = await provider
      .signUp("ada@example.test", "correct horse battery", "Ada")
      .catch((e: unknown) => e);

    expect((error as ProviderError).reason).toBe("unavailable");
  });

  it("bounds a hung provider and never lets a raw DOMException escape", async () => {
    const hanging = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, hanging, 30);

    const error = await provider
      .signUp("ada@example.test", "correct horse battery", "Ada")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(DOMException);
    expect((error as ProviderError).reason).toBe("unavailable");
  });

  it("treats an unparseable 2xx body as confirmation-required rather than throwing", async () => {
    // A 2xx this code cannot read is still the provider saying it accepted the signup.
    // Failing here would tell the caller something went wrong when an account may exist.
    const provider = createGoTrueProvider(
      config,
      fetchReturning(new Response("not json", { status: 200 })),
    );

    await expect(
      provider.signUp("ada@example.test", "correct horse battery", "Ada"),
    ).resolves.toEqual({ kind: "confirmation-required" });
  });
});
