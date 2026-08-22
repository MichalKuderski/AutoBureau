import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, resetActiveHousehold, setActiveHousehold } from "./api-client";
import { CSRF_HEADER } from "./csrf";

/**
 * The one place `X-Household-Id` is attached (blueprint P1-03).
 *
 * The blueprint's finding was that `apiFetch` supported the option and no caller passed
 * it, so every request went out unscoped. The fix must not become "every caller now
 * remembers" — that is the duplication this module's own header warns about — so these
 * assertions are about the header appearing without any call site mentioning it, and
 * about it staying absent when there is nothing to disambiguate.
 */

const HOUSEHOLD = "0192f5a1-0000-7000-8000-0000000000b1";

function lastRequest(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const mock = vi.mocked(globalThis.fetch);
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
  return { url, init: init as RequestInit & { headers: Record<string, string> } };
}

beforeEach(() => {
  resetActiveHousehold();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  resetActiveHousehold();
  vi.unstubAllGlobals();
});

describe("no selection is named when none is required", () => {
  it("sends no household header by default", async () => {
    await apiFetch("/households/current");
    expect(lastRequest().init.headers["X-Household-Id"]).toBeUndefined();
  });

  it("sends no household header when the active selection is explicitly null", async () => {
    // What a single-membership principal produces: `resolveRequestContext` resolves the
    // sole household by itself, so naming it would add a header with nothing to decide.
    setActiveHousehold(null);
    await apiFetch("/households/current");
    expect(lastRequest().init.headers["X-Household-Id"]).toBeUndefined();
  });
});

describe("the published selection reaches every request without a call site knowing", () => {
  it("attaches the header once a household is published", async () => {
    setActiveHousehold(HOUSEHOLD);
    await apiFetch("/households/current");
    expect(lastRequest().init.headers["X-Household-Id"]).toBe(HOUSEHOLD);
  });

  it("attaches it on unsafe methods too, alongside CSRF and idempotency", async () => {
    setActiveHousehold(HOUSEHOLD);
    await apiFetch("/obligations", { method: "POST", body: { title: "x" } });
    const { init } = lastRequest();
    expect(init.headers["X-Household-Id"]).toBe(HOUSEHOLD);
    expect(init.headers[CSRF_HEADER]).toBeDefined();
  });

  it("keeps attaching it across many calls, not just the first", async () => {
    setActiveHousehold(HOUSEHOLD);
    for (const path of ["/households/current", "/obligations", "/documents"]) {
      await apiFetch(path);
      expect(lastRequest().init.headers["X-Household-Id"]).toBe(HOUSEHOLD);
    }
  });

  it("an explicit option still wins over the published selection", async () => {
    const other = "0192f5a1-0000-7000-8000-0000000000b2";
    setActiveHousehold(HOUSEHOLD);
    await apiFetch("/households/current", { householdId: other });
    expect(lastRequest().init.headers["X-Household-Id"]).toBe(other);
  });
});

describe("the selection never leaves the /v1 door", () => {
  it("only ever goes to a same-origin /v1 path", async () => {
    setActiveHousehold(HOUSEHOLD);
    await apiFetch("/households/current");
    const { url, init } = lastRequest();
    // A relative /v1 path with same-origin credentials: the header cannot reach a third
    // party, because this client cannot address one.
    expect(url.startsWith("/v1/")).toBe(true);
    expect(init.credentials).toBe("same-origin");
  });

  it("is not attached by any module other than this one", async () => {
    // Proved by construction elsewhere: the repository-wide scan asserts no other file
    // writes this header. Here we pin that clearing the selection clears it everywhere,
    // which would be false if a second attach point existed.
    setActiveHousehold(HOUSEHOLD);
    await apiFetch("/households/current");
    expect(lastRequest().init.headers["X-Household-Id"]).toBe(HOUSEHOLD);

    resetActiveHousehold();
    await apiFetch("/households/current");
    expect(lastRequest().init.headers["X-Household-Id"]).toBeUndefined();
  });
});
