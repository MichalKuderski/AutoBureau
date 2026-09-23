import { discardProviderBody, readProviderJson } from "../http/provider-body";
import { PlaidError, type PlaidConfig } from "./errors";

const ROUTES = ["/link/token/create", "/item/public_token/exchange", "/item/remove", "/webhook_verification_key/get"] as const;
export type PlaidSandboxRoute = typeof ROUTES[number];

/** Only the four existing sandbox operations. This adds no endpoint, scheduling,
 * production-host switch, retry, token persistence, entitlement or financial ingestion.
 * The client's existing Zod schemas still validate each successful response.
 */
export function createPlaidSandboxTransport(config: PlaidConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000) {
  if (!/^[a-f0-9]{24}$/.test(config.clientId) || !/^[^\s]{16,256}$/.test(config.secret)
    || !["stg", "preview"].includes(config.scope)) throw new PlaidError("unconfigured");
  const { clientId, secret } = config;
  return async (route: PlaidSandboxRoute, data: unknown): Promise<unknown> => {
    if (!ROUTES.includes(route)) throw new PlaidError("invalid");
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(`https://sandbox.plaid.com${route}`, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret, "Plaid-Version": "2020-09-14" }, body: JSON.stringify(data),
      });
      // Classify definite status failures without requiring their body to be JSON or
      // waiting for a gateway's error page to finish streaming. Never consume secrets
      // from error bodies unless the existing reconnect contract needs the error code.
      if (response.status === 429) {
        discardProviderBody(response);
        throw new PlaidError("rate-limited");
      }
      if (response.status >= 500 || response.status >= 300 && response.status < 400) {
        discardProviderBody(response);
        throw new PlaidError("unavailable");
      }
      const value = await readProviderJson(response, signal);
      if (!response.ok) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)
          && "error_code" in value && value.error_code === "ITEM_LOGIN_REQUIRED") throw new PlaidError("reconnect");
        throw new PlaidError("unavailable");
      }
      return value;
    } catch (error) {
      if (error instanceof PlaidError) throw error;
      // No original error, response body, credentials or URLs become diagnostics.
      throw new PlaidError("unavailable");
    }
  };
}
