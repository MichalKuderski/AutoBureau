import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPlaidSandboxClient, plaidSandboxConfig } from "./client";
const config = { clientId: "a".repeat(24), secret: "synthetic-sandbox-secret", scope: "stg" as const };
const owner = { userId: randomUUID(), householdId: randomUUID() };
const link = { link_token: "link-sandbox-synthetic", expiration: "2026-09-20T00:00:00Z" };
function setup(value: unknown = link, status = 200) { const fetcher = vi.fn(async () => new Response(JSON.stringify(value), { status })); return { fetcher, client: createPlaidSandboxClient(config, fetcher as typeof fetch) }; }
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PLAID_SANDBOX_ENABLED: "true", PLAID_ENVIRONMENT: "sandbox", AUTH_ISSUER: "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1", VERCEL_PROJECT_ID: "prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR", VERCEL_ENV: "production", PLAID_CLIENT_ID: config.clientId, PLAID_SANDBOX_SECRET: config.secret };
describe("closed Plaid Sandbox boundary", () => {
  it("requires the exact staging project and explicit Sandbox activation", () => { expect(plaidSandboxConfig(env)).toEqual(config); expect(() => plaidSandboxConfig({ NODE_ENV: "test" })).toThrow(); });
  it.each([{ PLAID_ENVIRONMENT: "production" }, { PLAID_SANDBOX_ENABLED: "false" }, { VERCEL_PROJECT_ID: "production-project" }, { AUTH_ISSUER: "https://production.example" }, { VERCEL_ENV: "development" }, { PLAID_PRODUCTION_SECRET: "present" }, { NEXT_PUBLIC_PLAID_SECRET: "present" }])("refuses a misplaced environment", change => expect(() => plaidSandboxConfig({ ...env, ...change })).toThrow());
  it("creates a server-bound opaque Link identity with only read-only products", async () => {
    const { client, fetcher } = setup(); expect(await client.createLinkToken(owner)).toEqual(link);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe("https://sandbox.plaid.com/link/token/create");
    const data = JSON.parse(String(init.body)); expect(data).toMatchObject({ client_name: "Pellum", products: ["transactions"], optional_products: ["liabilities"] });
    expect(data.user.client_user_id).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(data)).not.toContain(owner.userId); expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("binds Link separately to user, household and hosting scope", async () => {
    const { client, fetcher } = setup(); await client.createLinkToken(owner); await client.createLinkToken({ ...owner, householdId: randomUUID() });
    await createPlaidSandboxClient({ ...config, scope: "preview" }, fetcher as typeof fetch).createLinkToken(owner);
    const ids = fetcher.mock.calls.map(c => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).user.client_user_id); expect(new Set(ids).size).toBe(3);
  });
  it("uses update mode without adding new products", async () => {
    const { client, fetcher } = setup(); await client.createLinkToken(owner, "access-sandbox-synthetic");
    const data = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)); expect(data.access_token).toBe("access-sandbox-synthetic"); expect(data.products).toBeUndefined();
  });
  it("exchanges one-time tokens server-side and strips unrelated response data", async () => {
    const { client } = setup({ access_token: "access-sandbox-synthetic", item_id: "opaque-item", extra: "not-returned" }); expect(await client.exchangePublicToken("public-sandbox-synthetic")).toEqual({ access_token: "access-sandbox-synthetic", item_id: "opaque-item" });
  });
  it("refuses real-environment tokens before any request", async () => {
    const { client, fetcher } = setup(); await expect(client.exchangePublicToken("public-production-anything")).rejects.toThrow(); await expect(client.removeItem("access-production-anything")).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a provider response containing a real-environment access token", async () => {
    await expect(setup({ access_token: "access-production-anything", item_id: "opaque" }).client.exchangePublicToken("public-sandbox-synthetic")).rejects.toThrow();
  });
  it("does not retry an ambiguous exchange or retain provider failure detail", async () => {
    const fetcher = vi.fn(async () => { throw new Error("secret provider response"); });
    await expect(createPlaidSandboxClient(config, fetcher).exchangePublicToken("public-sandbox-synthetic")).rejects.toThrow("Financial connection: unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[429, {}, "rate-limited"], [400, { error_code: "ITEM_LOGIN_REQUIRED", display_message: "sensitive" }, "reconnect"], [504, { error_message: "sensitive" }, "unavailable"]] as const)("maps only safe failure classifications", async (status, body, code) => {
    await expect(setup(body, status).client.createLinkToken(owner)).rejects.toThrow(`Financial connection: ${code}`);
  });
  it("bounds provider response size", async () => { await expect(setup({ value: "x".repeat(65537) }).client.createLinkToken(owner)).rejects.toThrow("unavailable"); });
  it("returns no access token or provider detail from successful removal", async () => { expect(await setup({ request_id: "opaque", extra: "sensitive" }).client.removeItem("access-sandbox-synthetic")).toBeUndefined(); });
});
