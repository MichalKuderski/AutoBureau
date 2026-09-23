// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAccountProvider } from "./account-provider";
import type { AuthConfig } from "./config";
import { providerFailureMeta } from "./provider";

const id = "a0000000-0000-4000-8000-000000000001", factorId = "a0000000-0000-4000-8000-000000000002";
const config = { apiUrl: "https://auth.invalid/auth/v1", anonKey: "public-fixture", allowedOrigins: ["https://pellum.invalid"], issuer: "https://auth.invalid", audience: "authenticated", jwks: { keys: { keys: [] } }, algorithms: ["RS256"], cookieName: "ab_session", refreshCookieName: "ab_session_refresh" } satisfies AuthConfig;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
function setup(body: unknown) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body));
  return { fetcher, p: createAccountProvider(config, fetcher) };
}
describe("bounded account provider transport", () => {
  it("projects only identity and supported factor state, excluding metadata", async () => {
    const { p, fetcher } = setup({ id, factors: [{ id: factorId, factor_type: "totp", status: "verified", secret: "never", friendly_name: "never" }], user_metadata: { admin: true } });
    expect(await p.factors("access")).toEqual({ userId: id, factors: [{ id: factorId, factor_type: "totp", status: "verified" }] });
    expect(fetcher.mock.calls[0]).toEqual([config.apiUrl + "/user", expect.objectContaining({ method: "GET", redirect: "manual", cache: "no-store", headers: expect.objectContaining({ authorization: "Bearer access", apikey: "public-fixture" }) })]);
  });
  it.each([{}, { id, factors: null }, { id, factors: [{ id: factorId, factor_type: "phone", status: "verified" }] },
    { id, factors: [{ id: factorId, factor_type: "totp", status: "unknown" }] },
    { id, factors: Array(11).fill({ id: factorId, factor_type: "totp", status: "verified" }) },
    { id, factors: Array(2).fill({ id: factorId, factor_type: "totp", status: "verified" }) }])("refuses unusable factor evidence %#", async body => {
    await expect(setup(body).p.factors("access")).rejects.toThrow("Account security");
  });
  it("accepts documented omitted empty factors", async () => expect(await setup({ id }).p.factors("access")).toEqual({ userId: id, factors: [] }));
  it("projects the setup secret, never provider SVG or URI", async () => {
    const { p, fetcher } = setup({ id: factorId, type: "totp", totp: { secret: "A".repeat(32), qr_code: "<script>hostile</script>", uri: "https://evil.invalid" } });
    expect(await p.enroll("access")).toEqual({ id: factorId, secret: "A".repeat(32) });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ factor_type: "totp", issuer: "Pellum" });
  });
  it("uses exact factor/challenge IDs and code body, never query credentials", async () => {
    const { p, fetcher } = setup({ access_token: "access.new", refresh_token: "refresh.new", expires_in: 3600 });
    expect(await p.verify("access", factorId, id, "123456")).toEqual({ accessToken: "access.new", refreshToken: "refresh.new", expiresIn: 3600 });
    expect(fetcher.mock.calls[0]![0]).toBe(`${config.apiUrl}/factors/${factorId}/verify`);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ challenge_id: id, code: "123456" });
  });
  it.each(["../user", "not-a-uuid", factorId + "/delete"]) ("refuses path injection %s", async bad => {
    const { p, fetcher } = setup({}); await expect(p.challenge("access", bad)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["12345", "1234567", "12\n456", "１２３４５６"]) ("refuses non-six-digit code", async code => {
    const { p, fetcher } = setup({}); await expect(p.verify("access", factorId, id, code)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400,401,403,404,422,429,500,504,302])("single attempt and coarse error for %i", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("password email secret must not escape", { status, headers: { "sb-request-id": id, "x-secret": "must-not-escape" } }));
    const p = createAccountProvider(config, fetcher);
    const error = await p.remove("access", factorId).catch(e => e);
    expect(error.message).not.toMatch(/password|email|secret/);
    expect(providerFailureMeta(error)).toMatchObject({ upstream_status: status, upstream_request_id: id });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses mismatched removal acknowledgement", async () => expect(setup({ id }).p.remove("access", factorId)).rejects.toThrow());
  it("reads challenge expiry as seconds", async () => expect(await setup({ id, type: "totp", expires_at: 1234 }).p.challenge("access", factorId)).toEqual({ id, expiresAt: 1234 }));
  it("recovery has fixed redirect; token hash redemption cannot become signup", async () => {
    const { p, fetcher } = setup({});
    await p.recover("synthetic@example.invalid");
    expect(fetcher.mock.calls[0]![0]).toBe(`${config.apiUrl}/recover?redirect_to=https%3A%2F%2Fpellum.invalid%2Fauth%2Frecovery`);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ email: "synthetic@example.invalid" });
    fetcher.mockResolvedValueOnce(json({ access_token: "recovery.access", refresh_token: "recovery.refresh", expires_in: 3600 }));
    await p.redeemRecovery("a".repeat(56));
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({ type: "recovery", token_hash: "a".repeat(56) });
  });
  it("bounds token/cookie values and never returns injected cookie text", async () => {
    await expect(setup({ access_token: "a; Secure=false", refresh_token: "r", expires_in: 3600 }).p.verify("a", factorId, id, "123456")).rejects.toThrow();
  });
  it("deadline covers provider body and does not retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }));
    await expect(createAccountProvider(config, fetcher, 20).factors("access")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("network exceptions carry no arbitrary original exception", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret response"));
    await expect(createAccountProvider(config, fetcher).revoke("access")).rejects.toThrow("Account security is unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("password updates project user ID only and revocation uses explicit global scope", async () => {
    const { p, fetcher } = setup({ id, user_metadata: { secret: "no" } });
    expect(await p.updatePassword("access", "synthetic-only-password")).toEqual({ userId: id });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ password: "synthetic-only-password" });
    await p.revoke("access"); expect(fetcher.mock.calls[1]![0]).toBe(`${config.apiUrl}/logout?scope=global`);
  });
});
