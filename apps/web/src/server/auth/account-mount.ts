import { z } from "zod";
import { CsrfError, assertSameSiteRequest } from "../http/csrf";
import { ProviderError } from "./provider";
import { getDatabase } from "../db";
import { authConfigFromEnv, type AuthConfig } from "./config";
import { createJwtVerifier } from "./jwt";
import { RequestContextError, membershipsVia, resolveRequestContext } from "./context";
import { createAccountProvider } from "./account-provider";
import { createAccountSecurityController } from "./account-security";
import { createDatabaseAccountSecurityPorts } from "./account-security-ports";
import { createRecoveryController, createRecoveryInitiator, type RecoveryPorts } from "./account-recovery";
import { createDatabaseRecoveryPorts, createDatabaseRecoveryInitiationPorts } from "./account-recovery-ports";
import { createLocalAccountRoutes } from "./local-account-routes";
import { assertLocalAccountMount } from "./local-account-mount";
import { passwordPolicyFor } from "./password-gate";
import type { PasswordVerdict } from "./password-policy";

type Env = Readonly<Record<string, string | undefined>>;
export type AccountMountMode = "local-synthetic" | "hosted" | "unavailable";

/**
 * Hosted, provider-backed account security and recovery. Only a hosted runtime with a
 * complete HTTPS auth configuration qualifies, and never one that also carries the local
 * synthetic switch. `ACCOUNT_SECURITY_DISABLED=1` is the operator kill switch: the routes
 * answer 404 and the pages say the feature is unavailable. Never log these values.
 */
export function assertHostedAccountMount(env: Env): void {
  const refuse = (): never => { throw new Error("Hosted account mount unavailable"); };
  if (env.ACCOUNT_SECURITY_DISABLED === "1" || env.LOCAL_ACCOUNT_ROUTES !== undefined) refuse();
  if (env.NODE_ENV !== "production" || env.VERCEL !== "1") refuse();
  const config = authConfigFromEnv(env as NodeJS.ProcessEnv);
  const https = (raw: string) => { const u = new URL(raw); if (u.protocol !== "https:" || u.search || u.hash) refuse(); };
  https(config.apiUrl); https(config.issuer);
  if (config.allowedOrigins.length === 0) refuse();
  for (const origin of config.allowedOrigins) https(origin);
}

/** The local synthetic mount keeps precedence; neither gate can select the other's path. */
export function accountMountMode(env: Env): AccountMountMode {
  if (env.ACCOUNT_SECURITY_DISABLED === "1") return "unavailable";
  try { assertLocalAccountMount(env); return "local-synthetic"; } catch { /* not local */ }
  try { assertHostedAccountMount(env); return "hosted"; } catch { /* not hosted */ }
  return "unavailable";
}
export const accountSecurityAvailable = (env: Env): boolean => accountMountMode(env) !== "unavailable";

/**
 * One composition for both mounts: the same controllers, durable challenge journal,
 * owner/fence admission, shared rate limits and audit. Only the gate and the breach-range
 * endpoint differ (fixture on synthetic loopback, the public k-anonymity service hosted).
 * Provider calls happen outside database transactions; ambiguous credential changes are
 * never retried (the controllers own that contract).
 */
export async function composeAccountRoutes(request: Request, config: AuthConfig,
  passwordPolicy: (password: string) => Promise<PasswordVerdict>, denied: (status: number) => Response): Promise<Response> {
  if (request.method !== "POST") return denied(405);
  assertSameSiteRequest(request, config);
  const db = getDatabase(), verifier = createJwtVerifier(config), provider = createAccountProvider(config);
  const unavailable = async () => denied(404);
  let security = unavailable as ReturnType<typeof createAccountSecurityController>;
  let complete = unavailable as ReturnType<typeof createRecoveryController>["complete"];
  const path = new URL(request.url).pathname;
  if (path === "/v1/account/security") {
    const ctx = await resolveRequestContext(request, { verifier, memberships: membershipsVia(db), cookieName: config.cookieName });
    security = createAccountSecurityController(config, provider, createDatabaseAccountSecurityPorts(db, ctx.householdId, verifier));
  }
  if (path === "/v1/auth/recovery/complete") {
    // A recovery token, once redeemed, establishes the principal. Household
    // selection is resolved from that identity, never a pre-redemption browser ID.
    let selected: ReturnType<typeof createDatabaseRecoveryPorts> | undefined;
    const requireSelected = () => { if (!selected) throw new Error("Recovery refused"); return selected; };
    const ports: RecoveryPorts = {
      ...createDatabaseRecoveryInitiationPorts(db, request),
      async verifyJwt(token) {
        const p = await verifier.verify(token), memberships = await membershipsVia(db)(p.userId);
        const candidate = request.headers.get("x-household-id");
        if (candidate !== null && !z.string().uuid().safeParse(candidate).success) throw new Error("Recovery refused");
        const member = candidate ? memberships.find(m => m.householdId === candidate) : memberships.length === 1 ? memberships[0] : undefined;
        if (!member || member.role !== "owner") throw new Error("Recovery refused");
        selected = createDatabaseRecoveryPorts(db, member.householdId, request, verifier, passwordPolicy);
        return p;
      },
      async passwordAllowed(password) {
        const verdict = await passwordPolicy(password);
        if (verdict === "unavailable") throw new ProviderError("unavailable", "Password policy unavailable");
        return verdict === "allowed";
      },
      admit: (...args) => requireSelected().admit(...args),
      audit: (...args) => requireSelected().audit(...args),
    };
    complete = createRecoveryController(config, provider, ports).complete;
  }
  const initiate = createRecoveryInitiator(config, provider, createDatabaseRecoveryInitiationPorts(db, request));
  return createLocalAccountRoutes(config, { security, initiate, complete })(request);
}

const refusal = (message: string) => (status: number) => Response.json({ error: message }, { status,
  headers: { "cache-control": "no-store, private", "referrer-policy": "no-referrer" } });

/** The only export the account/recovery route files may call. */
export async function accountMount(request: Request): Promise<Response> {
  const mode = accountMountMode(process.env);
  const denied = refusal(mode === "local-synthetic" ? "Local account operation is unavailable." : "Account operation is unavailable.");
  if (mode === "unavailable") return denied(404);
  try {
    const config = authConfigFromEnv();
    return await composeAccountRoutes(request, config, passwordPolicyFor(process.env, config.apiUrl), denied);
  } catch (e) { return denied(e instanceof CsrfError ? 403 : e instanceof RequestContextError ? e.status : 503); }
}
