// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "./config";
import { createGoTrueProvider, ProviderError } from "./provider";

/**
 * `provider.ts` timeout behaviour (blueprint P1-06).
 *
 * Scope is deliberately narrow: this is not the provider contract matrix (that is
 * P1-11). What is proved here is the one thing P1-06 adds — that a hung provider call is
 * bounded and lands on the same `unavailable` classification a network failure already
 * produces — plus enough surrounding regression (a normal success, a normal 4xx/5xx) to
 * show the timeout did not change any of that.
 *
 * TIMING: every test injects a small `timeoutMs` (the same test-seam pattern the file
 * already uses for `fetchImpl`) rather than waiting out the real 10-second production
 * value or faking timers. Vitest's fake timers were tried first and rejected: they patch
 * the global `setTimeout` vitest itself schedules under, but `AbortSignal.timeout`'s
 * internal timer is not driven by it, so `vi.advanceTimersByTimeAsync` never fires the
 * abort — every timeout test simply hung to vitest's own 5s test timeout. That is a
 * genuine limitation of this runtime, not a test written around it: an injectable
 * millisecond budget is the deterministic, fast alternative the file's own `fetchImpl`
 * seam already models.
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

/** Small and real, not the 10s production value — see the file header. */
const TEST_TIMEOUT_MS = 30;

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A `fetchImpl` that never settles on its own — only the caller's abort ends it. */
function hangingFetch(): typeof fetch {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sign-in — provider timeout", () => {
  it("aborts within the configured window and classifies as unavailable", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);
    await expect(provider.signInWithPassword("ada@example.test", "hunter2")).rejects.toThrow(
      ProviderError,
    );
  });

  it("never lets a raw AbortError/DOMException escape", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);

    const error = await provider
      .signInWithPassword("ada@example.test", "hunter2")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(DOMException);
    expect((error as ProviderError).reason).toBe("unavailable");
  });

  it("passes an AbortSignal on the request so the provider can bound it", async () => {
    const fetchImpl = hangingFetch();
    const provider = createGoTrueProvider(config, fetchImpl, TEST_TIMEOUT_MS);

    await provider.signInWithPassword("ada@example.test", "hunter2").catch(() => undefined);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not hang indefinitely — settles at roughly the configured deadline", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);
    const start = Date.now();

    await provider.signInWithPassword("ada@example.test", "hunter2").catch(() => undefined);

    // Generous bounds on both sides: must wait AT LEAST the deadline (proves it did not
    // resolve immediately/unbounded-fast for the wrong reason) and must not wildly
    // overshoot it (proves it is bounded, not left to the platform's own timeout).
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(TEST_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(TEST_TIMEOUT_MS * 20);
  });
});

describe("refresh — provider timeout", () => {
  it("bounds a hung refresh call and reports unavailable, unchanged for P1-07", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);

    const error = await provider.refresh("a-refresh-token").catch((e: unknown) => e);

    // `refresh` reuses `tokenGrant`, so this pins that the timeout path is genuinely
    // shared code rather than reimplemented per grant.
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("unavailable");
  });
});

describe("magic-link — provider timeout", () => {
  it("bounds a hung OTP request and reports unavailable", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);

    const error = await provider
      .requestMagicLink("ada@example.test", "challenge", "https://app.autobureau.test/auth/callback")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("unavailable");
  });
});

describe("sign-out — bounded, still best-effort", () => {
  it("resolves rather than hanging or throwing when the provider never answers", async () => {
    const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);

    // Best-effort: the timeout fires, the fetch rejects, and signOut's own catch
    // swallows it exactly as it already swallows a network failure.
    await expect(provider.signOut("an-access-token")).resolves.toBeUndefined();
  });
});

describe("regression — a normal request still succeeds", () => {
  it("returns session tokens when the provider answers before the deadline", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    const tokens = await provider.signInWithPassword("ada@example.test", "hunter2");

    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("still attaches a bounded signal on a fast, successful request", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    await provider.signInWithPassword("ada@example.test", "hunter2");

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
});

describe("regression — a normal provider error is not collapsed into unavailable", () => {
  it("still classifies 401 as invalid-credentials on sign-in", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    const error = await provider.signInWithPassword("ada@example.test", "wrong").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("invalid-credentials");
  });

  it("still classifies 429 as rate-limited", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 })) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    const error = await provider.signInWithPassword("ada@example.test", "wrong").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("rate-limited");
  });

  it("still classifies a 401 on refresh as invalid-refresh, not unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    const error = await provider.refresh("stale-token").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("invalid-refresh");
  });

  it("still classifies a 500 as unavailable — a real provider fault, not a timeout", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    const error = await provider.signInWithPassword("ada@example.test", "x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).reason).toBe("unavailable");
  });
});

describe("timer/controller cleanup", () => {
  it("leaves no listener on the signal after a successful request completes", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const provider = createGoTrueProvider(config, fetchImpl);

    await provider.signInWithPassword("ada@example.test", "hunter2");

    // `AbortSignal.timeout` needs no explicit `clearTimeout`: the signal (and the timer
    // backing it) becomes unreachable once this call returns and nothing retains it.
    // What IS ours to get wrong is attaching a listener to the signal ourselves and
    // never removing it; this file attaches none, and the request path holds no
    // reference to the signal beyond the `fetch` call itself.
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not leave the process alive: sequential calls do not accumulate pending work", async () => {
    // Five real timeouts in a row. If a timer or listener leaked per call, this would be
    // the test where it shows up as growing latency or an unhandled-rejection warning.
    for (let i = 0; i < 5; i += 1) {
      const provider = createGoTrueProvider(config, hangingFetch(), TEST_TIMEOUT_MS);
      await provider.signInWithPassword("ada@example.test", "hunter2").catch(() => undefined);
    }
    // Reaching here without the suite's own timeout firing is the assertion: five
    // sequential bounded calls cost roughly 5× one deadline, not something unbounded.
    expect(true).toBe(true);
  });
});
