// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * ADR-010 — the policy as the middleware actually emits it.
 *
 * `csp.test.ts` covers the policy string in isolation. What it cannot show is the part
 * that made the old comment false: whether the nonce the browser is told to enforce is
 * the same one the page is rendered with. Three headers have to agree on every response —
 * the enforced policy, the `x-nonce` the root layout stamps onto the theme script, and
 * the request-side policy Next reads to stamp its own streamed scripts. A nonce that
 * appears in only one of them is decoration.
 *
 * Next encodes forwarded request headers onto the response as
 * `x-middleware-request-<name>`; that is what the two request-side assertions read.
 */

const ORIGIN = "https://app.autobureau.com";

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (jar) headers.set("cookie", jar);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function nonceOf(csp: string | null): string {
  expect(csp).not.toBeNull();
  const match = /'nonce-([^']+)'/.exec(csp ?? "");
  expect(match, `no nonce source in: ${csp}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Test A · every response carries a nonce-bearing policy", () => {
  it("an allowed public page gets one", async () => {
    const response = await middleware(request("/sign-in"));
    expect(nonceOf(response.headers.get("content-security-policy"))).not.toBe("");
  });

  it("the policy is the full one, not a fragment", async () => {
    const csp = (await middleware(request("/"))).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("Test C · the enforced nonce is the one the page is rendered with", () => {
  it("the response policy, x-nonce, and the request policy all name the same nonce", async () => {
    const response = await middleware(request("/sign-in"));

    const enforced = nonceOf(response.headers.get("content-security-policy"));
    // What `headers().get("x-nonce")` returns in the root layout.
    const forNonceHeader = response.headers.get("x-middleware-request-x-nonce");
    // What Next reads to stamp the RSC payload scripts it inlines itself.
    const forFramework = nonceOf(
      response.headers.get("x-middleware-request-content-security-policy"),
    );

    expect(forNonceHeader).toBe(enforced);
    expect(forFramework).toBe(enforced);
  });

  it("forwards both request headers, so neither reader is left guessing", async () => {
    const response = await middleware(request("/sign-in"));
    const overridden = response.headers.get("x-middleware-override-headers") ?? "";
    expect(overridden).toContain("x-nonce");
    expect(overridden).toContain("content-security-policy");
  });
});

describe("Test B · the nonce is per-request, not per-process", () => {
  it("two identical requests receive different nonces", async () => {
    const first = nonceOf((await middleware(request("/"))).headers.get("content-security-policy"));
    const second = nonceOf((await middleware(request("/"))).headers.get("content-security-policy"));
    expect(first).not.toBe(second);
  });

  it("stays unique across many requests", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      nonces.add(nonceOf((await middleware(request("/"))).headers.get("content-security-policy")));
    }
    expect(nonces.size).toBe(64);
  });
});

describe("Test D · no response reintroduces 'unsafe-inline' for script", () => {
  it.each(["/", "/sign-in", "/dashboard", "/v1/households/current"])(
    "%s has no 'unsafe-inline' in script-src",
    async (path) => {
      const csp = (await middleware(request(path))).headers.get("content-security-policy") ?? "";
      const scriptSrc = csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src"));
      expect(scriptSrc).toBeDefined();
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    },
  );
});

describe("Test G · the policy survives every branch, not just the happy one", () => {
  it("a redirect to sign-in still carries it", async () => {
    // No auth configuration in the test environment, so a protected page denies and
    // redirects — the branch that returns a response the old code never touched.
    const response = await middleware(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
    expect(nonceOf(response.headers.get("content-security-policy"))).not.toBe("");
  });

  it("a 401 on the API boundary still carries it", async () => {
    const response = await middleware(request("/v1/households/current"));
    expect(response.status).toBe(401);
    expect(nonceOf(response.headers.get("content-security-policy"))).not.toBe("");
  });

  it("does not change which response the routing decision produces", async () => {
    // The CSP is layered onto `evaluate`'s outcome and must not influence it. ADR-009's
    // own tests pin the decisions; this pins that adding a header left them alone.
    expect((await middleware(request("/sign-in"))).status).toBe(200);
    expect((await middleware(request("/dashboard"))).status).toBe(307);
    expect((await middleware(request("/v1/households/current"))).status).toBe(401);
  });
});
