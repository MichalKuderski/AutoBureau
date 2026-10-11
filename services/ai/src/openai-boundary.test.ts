import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createOfflineOpenAiRunner, OPENAI_RUNTIME, runLiveOpenAi, type LocalBinding, type OfflinePolicy, type MockReply } from "./openai-boundary.js";
import { PUBLIC_SYNTHETIC_DOCUMENT, parsePublicSyntheticDocument, redactParsedDocument, type ProviderInput } from "./redaction.js";
const sha = createHash("sha256").update(PUBLIC_SYNTHETIC_DOCUMENT).digest("hex");
const binding: LocalBinding = { householdId: "11111111-1111-4111-8111-111111111111", processingId: "22222222-2222-4222-8222-222222222222", leaseToken: "33333333-3333-4333-8333-333333333333", sourceSha256: sha, promptVersion: "closed-fixture-v1" };
const policy: OfflinePolicy = { mode: "offline-mock", model: "gpt-6.1-sol", budgetMicrousd: 5_000_000, maxAttempts: 2, attemptTimeoutMs: 1000, totalTimeoutMs: 2000 };
const capability = () => redactParsedDocument(parsePublicSyntheticDocument({ bytes: new TextEncoder().encode(PUBLIC_SYNTHETIC_DOCUMENT), format: "pellum-public-synthetic-v1" })).capability;
const success = (): MockReply => ({ status: 200, body: { id: "synthetic_response", model: policy.model, status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"classification":"deadline-notice","decision":"requires-human-review"}' }] }] } });
describe("disabled OpenAI boundary", () => {
  it("cannot enable live execution", () => { expect(OPENAI_RUNTIME).toEqual({ enabled: false, model: null }); expect(runLiveOpenAi).toThrow("disabled"); });
  it.each([{ mode: "live" }, { model: "gpt-6-sol" }, { budgetMicrousd: 5_000_001 }, { maxAttempts: 3 }, { attemptTimeoutMs: 0 }, { totalTimeoutMs: 46_000 }, { secret: "must-not-be-read" }])("rejects invalid configuration %j", bad => { expect(() => createOfflineOpenAiRunner({ ...policy, ...bad } as OfflinePolicy, async () => success())).toThrow("disabled"); });
  it("emits only approved fixed enums; keeps tenant/hash/date/lease local", async () => {
    const transport = vi.fn(async (_request: Readonly<Record<string, unknown>>, _signal: AbortSignal) => success()); const runner = createOfflineOpenAiRunner(policy, transport);
    const result = await runner.run(capability(), binding); const req = transport.mock.calls[0]![0];
    expect(JSON.stringify(req)).not.toContain(binding.householdId); expect(JSON.stringify(req)).not.toContain(sha); expect(JSON.stringify(req)).not.toContain("2026-10-01");
    expect(req).toMatchObject({ store: false, background: false, tools: [], model: policy.model });
    expect(result).toMatchObject({ providerCalled: false, status: "requires-human-review", provenance: binding });
    expect(runner.reservedMicrousd).toBe(36_864);
  });
  it("rejects a forged capability before transport or reservation", async () => {
    const t = vi.fn(async () => success()), r = createOfflineOpenAiRunner(policy, t);
    await expect(r.run({} as ProviderInput, binding)).rejects.toThrow(); expect(t).not.toHaveBeenCalled(); expect(r.reservedMicrousd).toBe(0);
  });
  it("requires the actual admitted source hash, consumes mismatch", async () => {
    const t = vi.fn(async () => success()), r = createOfflineOpenAiRunner(policy, t), input = capability();
    await expect(r.run(input, { ...binding, sourceSha256: "a".repeat(64) })).rejects.toThrow();
    await expect(r.run(input, binding)).rejects.toThrow(); expect(t).not.toHaveBeenCalled();
  });
  it("rejects duplicate job even with a changed lease/source", async () => {
    const t = vi.fn(async () => success()), r = createOfflineOpenAiRunner(policy, t);
    await r.run(capability(), binding);
    await expect(r.run(capability(), { ...binding, leaseToken: binding.householdId })).rejects.toThrow("duplicate"); expect(t).toHaveBeenCalledTimes(1);
  });
  it("keys separate households independently without transmitting either", async () => {
    const t = vi.fn(async () => success()), r = createOfflineOpenAiRunner(policy, t);
    await r.run(capability(), binding); await r.run(capability(), { ...binding, householdId: binding.leaseToken }); expect(t).toHaveBeenCalledTimes(2);
  });
  it("reserves all attempts before consuming authority", async () => {
    const t = vi.fn(async () => success()), r = createOfflineOpenAiRunner({ ...policy, budgetMicrousd: 36_863 }, t);
    await expect(r.run(capability(), binding)).rejects.toThrow("budget"); expect(t).not.toHaveBeenCalled();
  });
  it("bounds explicit server retries", async () => {
    const t = vi.fn().mockResolvedValueOnce({ status: 503, body: null }).mockResolvedValueOnce(success());
    await createOfflineOpenAiRunner(policy, t).run(capability(), binding); expect(t).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 429])("does not retry status %i", async status => {
    const t = vi.fn(async () => ({ status, body: null })); await expect(createOfflineOpenAiRunner(policy, t).run(capability(), binding)).rejects.toThrow("refused"); expect(t).toHaveBeenCalledTimes(1);
  });
  it("caps repeated server errors", async () => {
    const t = vi.fn(async () => ({ status: 503, body: null })); await expect(createOfflineOpenAiRunner(policy, t).run(capability(), binding)).rejects.toThrow("refused"); expect(t).toHaveBeenCalledTimes(2);
  });
  it("timeout aborts and poisons runner rather than overlap ambiguous work", async () => {
    let signal: AbortSignal | undefined;
    const t = vi.fn((_req: Readonly<Record<string, unknown>>, s: AbortSignal) => { signal = s; return new Promise<MockReply>(() => {}); });
    const r = createOfflineOpenAiRunner({ ...policy, attemptTimeoutMs: 5 }, t);
    await expect(r.run(capability(), binding)).rejects.toThrow("indeterminate"); expect(signal?.aborted).toBe(true);
    await expect(r.run(capability(), { ...binding, processingId: binding.householdId })).rejects.toThrow("indeterminate"); expect(t).toHaveBeenCalledTimes(1);
  });
  it("sanitizes transport errors and does not retry ambiguity", async () => {
    const t = vi.fn(async () => { throw new Error("SECRET PROVIDER RESPONSE"); });
    await expect(createOfflineOpenAiRunner(policy, t).run(capability(), binding)).rejects.toThrow("indeterminate"); expect(t).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { status: "incomplete", model: policy.model }, { ...success().body as object, model: "gpt-6-astra" }])("rejects incomplete/malformed/model-mismatched responses", async body => {
    await expect(createOfflineOpenAiRunner(policy, async () => ({ status: 200, body })).run(capability(), binding)).rejects.toThrow("refused");
  });
  it.each(['{"classification":"deadline-notice","decision":"requires-human-review","date":"2028-01-01"}', '{"classification":"deadline-notice","classification":"deadline-notice","decision":"requires-human-review"}', '{"classification":"deadline-notice","decision":"apply"}'])("rejects extra, duplicate and executable result fields", async text => {
    const body = { id: "mock", model: policy.model, status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] };
    await expect(createOfflineOpenAiRunner(policy, async () => ({ status: 200, body })).run(capability(), binding)).rejects.toThrow("refused");
  });
  it("sanitizes hostile response inspection and refuses type coercion", async () => {
    const bodies: unknown[] = [new Proxy({}, { getPrototypeOf() { throw new Error("PRIVATE CONTENT"); } }),
      { ...success().body as object, output: [...(success().body as { output: unknown[] }).output, { type: { toString() { throw new Error("PRIVATE CONTENT"); } } }] }];
    for (const body of bodies) {
      await expect(createOfflineOpenAiRunner(policy, async () => ({ status: 200, body })).run(capability(), binding)).rejects.toThrow("OpenAI boundary refused: refused");
    }
  });
  it("busy refusal preserves capability for later; does not overlap transports", async () => {
    let finish!: (reply: MockReply) => void;
    const t = vi.fn(() => new Promise<MockReply>(resolve => { finish = resolve; }));
    const r = createOfflineOpenAiRunner(policy, t), first = r.run(capability(), binding);
    await Promise.resolve(); const secondInput = capability();
    const secondBinding = { ...binding, processingId: binding.householdId };
    await expect(r.run(secondInput, secondBinding)).rejects.toThrow("busy");
    finish(success()); await first;
    const second = r.run(secondInput, secondBinding); await Promise.resolve(); finish(success()); await second;
    expect(t).toHaveBeenCalledTimes(2);
  });
  it("budget refusal does not burn capability", async () => {
    const input = capability();
    await expect(createOfflineOpenAiRunner({ ...policy, budgetMicrousd: 1 }, async () => success()).run(input, binding)).rejects.toThrow("budget");
    await expect(createOfflineOpenAiRunner(policy, async () => success()).run(input, binding)).resolves.toMatchObject({ providerCalled: false });
  });
  it("will not retry when total deadline cannot include backoff", async () => {
    const t = vi.fn(async () => ({ status: 503, body: null }));
    await expect(createOfflineOpenAiRunner({ ...policy, attemptTimeoutMs: 5, totalTimeoutMs: 5 }, t).run(capability(), binding)).rejects.toThrow("indeterminate");
    expect(t).toHaveBeenCalledTimes(1);
  });

  it("supports the exact Astra candidate with its own reservation", async () => {
    const body = { ...success().body as object, model: "gpt-6-astra" };
    const r = createOfflineOpenAiRunner({ ...policy, model: "gpt-6-astra" }, async () => ({ status: 200, body }));
    await expect(r.run(capability(), binding)).resolves.toMatchObject({ provenance: { model: "gpt-6-astra" } });
    expect(r.reservedMicrousd).toBe(184_320);
  });

});
