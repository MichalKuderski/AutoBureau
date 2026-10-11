import { createHash } from "node:crypto";
import { takeSourceBoundProviderPayload, type ProviderInput } from "./redaction.js";

/** Local/mock control plane only. ADR-018's fixed projection is unchanged. No SDK,
 * HTTP client, credentials, DB authority, environment lookup or live entry point. */
export const OPENAI_CANDIDATES = ["gpt-6-astra", "gpt-6.1-sol"] as const;
export type OpenAiCandidate = typeof OPENAI_CANDIDATES[number];
export const OPENAI_RUNTIME = Object.freeze({ enabled: false, model: null });
const outputSchema = {
  type: "object", additionalProperties: false,
  properties: { classification: { type: "string", enum: ["deadline-notice"] },
    decision: { type: "string", enum: ["requires-human-review"] } },
  required: ["classification", "decision"],
} as const;
export class OpenAiBoundaryError extends Error {
  constructor(readonly reason: "disabled" | "invalid" | "duplicate" | "budget" | "busy" | "indeterminate" | "refused") {
    super(`OpenAI boundary refused: ${reason}`);
  }
}
export interface LocalBinding {
  readonly householdId: string; readonly processingId: string; readonly leaseToken: string;
  readonly sourceSha256: string; readonly promptVersion: "closed-fixture-v1";
}
export interface OfflinePolicy {
  readonly mode: "offline-mock"; readonly model: OpenAiCandidate;
  readonly budgetMicrousd: number; readonly maxAttempts: 1 | 2;
  readonly attemptTimeoutMs: number; readonly totalTimeoutMs: number;
}
export interface MockReply { readonly status: number; readonly body: unknown }
export type MockTransport = (request: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<MockReply>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => d.get === undefined && d.set === undefined);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k) && Object.getOwnPropertyDescriptor(v, k)?.get === undefined);

function parse(body: unknown, model: OpenAiCandidate) {
  try {
  if (!object(body) || body.model !== model || body.status !== "completed" || body.error != null
    || typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id) || !Array.isArray(body.output)) throw new OpenAiBoundaryError("refused");
  const messages = body.output.filter((v: unknown) => object(v) && v.type === "message");
  if (messages.length !== 1 || body.output.some((v: unknown) => !object(v) || (typeof v.type !== "string" || !["message", "reasoning"].includes(v.type)))) throw new OpenAiBoundaryError("refused");
  const message = messages[0] as Record<string, unknown>;
  if (message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content) || message.content.length !== 1) throw new OpenAiBoundaryError("refused");
  const content: unknown = message.content[0];
  if (!object(content) || content.type !== "output_text" || typeof content.text !== "string" || content.text.length > 512) throw new OpenAiBoundaryError("refused");
  // Closed output accepts only two known values. Duplicate/escaped keys, extra
  // fields and arbitrary strings cannot be normalized into an accepted result.
  const allowed = /^\s*\{\s*"classification"\s*:\s*"deadline-notice"\s*,\s*"decision"\s*:\s*"requires-human-review"\s*\}\s*$|^\s*\{\s*"decision"\s*:\s*"requires-human-review"\s*,\s*"classification"\s*:\s*"deadline-notice"\s*\}\s*$/;
  if (!allowed.test(content.text)) throw new OpenAiBoundaryError("refused");
  return body.id;
  } catch { throw new OpenAiBoundaryError("refused"); }
}

/** A bounded, single-process MOCK runner. Bindings are supplied by a trusted local
 * broker, not authenticated here. In-memory dedup is not a durable job lease or RLS.
 * Started timeout is terminal/indeterminate: never launch a second ambiguous call. */
export function createOfflineOpenAiRunner(policy: OfflinePolicy, transport: MockTransport) {
  if (!exact(policy, ["mode", "model", "budgetMicrousd", "maxAttempts", "attemptTimeoutMs", "totalTimeoutMs"])
    || policy.mode !== "offline-mock" || !OPENAI_CANDIDATES.includes(policy.model)
    || !integer(policy.budgetMicrousd, 1, 5_000_000) || ![1, 2].includes(policy.maxAttempts)
    || !integer(policy.attemptTimeoutMs, 1, 20_000) || !integer(policy.totalTimeoutMs, policy.attemptTimeoutMs, 45_000)
    || typeof transport !== "function") throw new OpenAiBoundaryError("disabled");
  const config = Object.freeze({ ...policy });
  // Reservation assumes a deliberately conservative 4096-input/1024-output token
  // ceiling for this fixed tiny request only, standard price and no paid tools.
  // It is a MOCK guard, not a vendor billing cap or tokenizer proof.
  const costPerAttempt = config.model === "gpt-6-astra" ? 92_160 : 18_432;
  const spent = new Set<string>(); let reserved = 0; let active = false; let uncertain = false;
  return Object.freeze({
    get reservedMicrousd() { return reserved; },
    async run(input: ProviderInput, binding: LocalBinding) {
      if (!exact(binding, ["householdId", "processingId", "leaseToken", "sourceSha256", "promptVersion"])
        || ![binding.householdId, binding.processingId, binding.leaseToken].every(v => typeof v === "string" && uuid.test(v))
        || typeof binding.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.sourceSha256) || binding.promptVersion !== "closed-fixture-v1") throw new OpenAiBoundaryError("invalid");
      // Same household/job cannot be charged twice by changing lease, source or model.
      const key = `${binding.householdId}:${binding.processingId}`;
      if (spent.has(key)) throw new OpenAiBoundaryError("duplicate");
      if (uncertain) throw new OpenAiBoundaryError("indeterminate");
      if (active) throw new OpenAiBoundaryError("busy");
      const reserve = costPerAttempt * config.maxAttempts;
      if (reserved + reserve > config.budgetMicrousd) throw new OpenAiBoundaryError("budget");
      const payload = takeSourceBoundProviderPayload(input, binding.sourceSha256); // unforgeable, single-use, closed enums
      const localBinding = Object.freeze({ ...binding });
      spent.add(key); reserved += reserve; active = true;
      const request = JSON.stringify({ model: config.model, store: false, background: false, tools: [], max_output_tokens: 1024,
        reasoning: { effort: "low" }, input: [{ role: "user", content: JSON.stringify(payload) }],
        text: { format: { type: "json_schema", name: "pellum_closed_fixture", strict: true, schema: outputSchema } } });
      const deadline = performance.now() + config.totalTimeoutMs;
      try {
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
          const remaining = Math.min(config.attemptTimeoutMs, deadline - performance.now());
          if (remaining <= 0) throw new OpenAiBoundaryError("indeterminate");
          const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
          let reply: MockReply;
          try {
            reply = await Promise.race([
              Promise.resolve().then(() => transport(JSON.parse(request) as Record<string, unknown>, controller.signal)),
              new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OpenAiBoundaryError("indeterminate")); }, remaining); }),
            ]);
          } catch { uncertain = true; throw new OpenAiBoundaryError("indeterminate"); }
          finally { if (timer) clearTimeout(timer); }
          // Only explicit server unavailability permits a second mock attempt.
          // 429 can be persistent quota; network/timeout completion is ambiguous.
          try {
            if (!object(reply) || !integer(reply.status, 100, 599)) throw new OpenAiBoundaryError("refused");
            reply = { status: reply.status, body: reply.body };
          }
          catch { throw new OpenAiBoundaryError("refused"); }
          if ([500, 502, 503, 529].includes(reply.status) && attempt < config.maxAttempts) {
            const delay = 10 * attempt;
            if (performance.now() + delay >= deadline) throw new OpenAiBoundaryError("indeterminate");
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          if (reply.status !== 200) throw new OpenAiBoundaryError("refused");
          const responseId = parse(reply.body, config.model);
          return Object.freeze({ source: "openai-offline-mock" as const, providerCalled: false as const,
            classification: "deadline-notice" as const, status: "requires-human-review" as const,
            provenance: Object.freeze({ ...localBinding, model: config.model, responseId,
              requestSha256: createHash("sha256").update(request).digest("hex"), schemaVersion: "closed-fixture-v1" as const }) });
        }
        throw new OpenAiBoundaryError("refused");
      } finally { active = false; }
    },
  });
}
export function runLiveOpenAi(): never { throw new OpenAiBoundaryError("disabled"); }
