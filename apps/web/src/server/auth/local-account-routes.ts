import { recoveryFailure } from "./recovery-diagnostics";
import { z } from "zod";
import type { AuthConfig } from "./config";
import { readCookie } from "./context";
import { jsonBody } from "../http/body";
import { assertSameSiteRequest } from "../http/csrf";
import { LOCAL_ACCOUNT_ROUTES } from "./operation-matrix";
import type { createAccountSecurityController } from "./account-security";
import type { createRecoveryController } from "./account-recovery";

/** Dependency-injected HTTP seam. Next exports reach it only through account-mount.ts
 * (its hosted gate or the independent synthetic loopback gate).
 * Real controllers, signed identity and DB adapters can be composed in disposable
 * integration tests. Initiation needs neither a session nor a household candidate.
 * No bearer authorization input, query token, or browser factor evidence is trusted. */
export function createLocalAccountRoutes(config: AuthConfig, controllers: {
  security: ReturnType<typeof createAccountSecurityController>;
  initiate: ReturnType<typeof createRecoveryController>["initiate"];
  complete: ReturnType<typeof createRecoveryController>["complete"];
}) {
  return async (request: Request): Promise<Response> => {
    const denied = (status: number) => Response.json({ error: "Account request could not be completed." },
      { status, headers: { "cache-control": "no-store, private", "referrer-policy": "no-referrer" } });
    const path = new URL(request.url).pathname;
    if (!Object.hasOwn(LOCAL_ACCOUNT_ROUTES, path)) return denied(404);
    if (request.method !== "POST") return denied(405);
    try {
      assertSameSiteRequest(request, config);
      const route = LOCAL_ACCOUNT_ROUTES[path as keyof typeof LOCAL_ACCOUNT_ROUTES];
      const token = route === "security" ? readCookie(request.headers.get("cookie"), config.cookieName) : null;
      if (route === "security" && !token) return denied(401);
      const input: unknown = await jsonBody(request, z.unknown(), 4096);
      if (route === "security") return controllers.security(request, token!, input);
      return controllers[route](request, input);
    } catch (cause) { recoveryFailure(cause); return denied(403); }
  };
}
