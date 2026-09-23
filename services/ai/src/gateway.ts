import { takeProviderPayload, type ProviderInput } from "./redaction.js";

/** Deterministic LOCAL stub only. There is no injectable network client, provider
 * SDK, environment lookup, database, item_secrets resolver or logging capability.
 * The returned class cannot create an obligation or assert a source date. Hosted
 * gateway isolation, real parser coverage and activation remain separate gates. */
export function classifyWithLocalStub(input: ProviderInput) {
  const payload = takeProviderPayload(input);
  return Object.freeze({ source: "local-stub" as const, classification: payload.kind,
    status: "requires-human-review" as const, providerCalled: false as const });
}
