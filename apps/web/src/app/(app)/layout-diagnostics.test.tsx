// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Database } from "@autobureau/db";
import type { PrismaClient } from "@prisma/client";
import { setLogSink, resetLogSink, type LogRecord } from "@/server/observability/logger";
import { observeDashboardTransaction } from "@/server/observability/dashboard-render";
import { DASHBOARD_RENDER_HEADER } from "@/server/http/dashboard-render-marker";
import AppLayout from "./layout";
import { TokenError } from "@/server/auth/jwt";
import { HouseholdChooser } from "@/components/layout/household-chooser";

const state = vi.hoisted(() => ({ db: undefined as Database | undefined,
  verify: vi.fn(), factors: vi.fn(), headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/auth/config", () => ({ authConfigFromEnv: () => ({ cookieName: "session", jwks: {}, issuer: "unused", audience: "unused", algorithms: ["ES256"] }) }));
vi.mock("@/server/auth/jwt", async original => ({ ...await original<typeof import("@/server/auth/jwt")>(), createJwtVerifier: () => ({ verify: state.verify }) }));
vi.mock("@/server/auth/account-provider", () => ({ createAccountProvider: () => ({ factors: state.factors }) }));
vi.mock("@/server/db", () => ({ getDatabase: () => state.db! }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/patterns/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/layout/household-chooser", () => ({ HouseholdChooser: () => null }));

const user = "00000000-0000-4000-8000-000000000001", household = "00000000-0000-4000-8000-000000000002";
const records: LogRecord[] = [];
let failAt = 0, calls = 0;
let memberships: Array<{ householdId: string; role: "owner" }> = [];
const failure = Object.assign(new Error("PRIVATE token password SELECT customer@example.test"), { code: "P2028" });
beforeEach(() => {
  records.length = 0; calls = 0; failAt = 0;
  memberships = [{ householdId: household, role: "owner" }];
  state.headers = new Headers({ cookie: "session=PRIVATE", [DASHBOARD_RENDER_HEADER]: "1", "x-request-id": "PRIVATE-correlation" });
  const now = Math.floor(Date.now() / 1000);
  state.verify.mockReset().mockResolvedValue({ userId: user, expiresAt: now + 3600,
    assurance: { sessionId: user, level: "aal1", methods: [{ method: "password", timestamp: now - 1 }] } });
  state.factors.mockReset().mockResolvedValue({ userId: user, factors: [] });
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async (strings: TemplateStringsArray) => strings.join("").includes("requires_mfa")
      ? [{ requires_mfa: false, now: new Date() }] : strings.join("").includes("effective_plan") ? [{ tier: "free" }] : [{ id: user }],
    householdUser: { findMany: async () => memberships, findFirst: async () => ({ userId: user }) },
    household: { findFirst: async () => ({ id: household, name: "PRIVATE", emailAlias: "PRIVATE" }) },
    householdMember: { findMany: async () => [] },
    user: { findUnique: async () => ({ email: "PRIVATE", profile: null }) },
  };
  const raw = { $extends: () => raw, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
    if (++calls === failAt) throw failure;
    return fn(tx);
  } };
  state.db = new Database(raw as unknown as PrismaClient, observeDashboardTransaction);
  setLogSink(record => records.push(record));
});
afterEach(resetLogSink);

it("traces the actual layout's identity, memberships, option and shell admissions and data transactions", async () => {
  await AppLayout({ children: null });
  const tx = records.filter(r => r.event === "dashboard.render_transaction");
  expect(tx).toHaveLength(10); // context + options memberships, then four transactions per session
  expect(tx.every(r => r.meta?.outcome === "success")).toBe(true);
  for (const phase of ["identity_verify", "memberships", "provider_factors", "admission_before", "admission_after_factors", "admission_after_task", "option_read", "shell_read"]) {
    expect(records.some(r => (r.meta?.phases as string[] | undefined)?.includes(phase))).toBe(true);
  }
  expect(state.verify).toHaveBeenCalledTimes(2);
  expect(state.factors).toHaveBeenCalledTimes(2);
  expect(new Set(records.map(r => r.trace_id)).size).toBe(1);
  expect(records.at(-1)).toMatchObject({ event: "dashboard.render_complete", route: "/dashboard", meta: { outcome: "success", dropped: 0 } });
  expect(records.find(r => r.event === "dashboard.render_resolution")?.meta).toEqual({ resolution: "ready" });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|00000000|customer@example|SELECT/);
});

it.each(["unauthenticated", "no-membership"])("preserves the %s redirect and records its resolution", async reason => {
  if (reason === "unauthenticated") state.verify.mockRejectedValue(new TokenError("expired", "PRIVATE"));
  else memberships = [];
  const destination = reason === "unauthenticated" ? "/sign-in" : "/onboarding";
  await expect(AppLayout({ children: null })).rejects.toThrow(`redirect:${destination}`);
  expect(records.find(r => r.event === "dashboard.render_resolution")?.meta).toEqual({ resolution: reason === "unauthenticated" ? "sign-in" : "onboarding" });
  expect(state.factors).not.toHaveBeenCalled();
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
});

it("keeps a refused household preference fallback scoped to verified memberships", async () => {
  state.headers.set("cookie", "session=PRIVATE; ab_household=00000000-0000-4000-8000-000000000003");
  await AppLayout({ children: null });
  expect(records.some(r => (r.meta?.phases as string[] | undefined)?.includes("context_fallback"))).toBe(true);
  expect(records.find(r => r.event === "dashboard.render_resolution")?.meta).toEqual({ resolution: "ready" });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|00000000/);
});

it("preserves the multi-household chooser and validates each option without duplicate identity phases", async () => {
  memberships.push({ householdId: "00000000-0000-4000-8000-000000000003", role: "owner" });
  const result = await AppLayout({ children: null });
  expect(result.type).toBe(HouseholdChooser);
  expect(state.factors).toHaveBeenCalledTimes(2);
  expect(records.filter(r => r.event === "dashboard.render_phase" && (r.meta?.phases as string[]).at(-1) === "identity_verify")).toHaveLength(2);
  expect(records.find(r => r.event === "dashboard.render_resolution")?.meta).toEqual({ resolution: "choose" });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|00000000/);
});

it("preserves the locked account-security view and never proceeds to shell reads", async () => {
  state.factors.mockResolvedValue({ userId: user, factors: [{ id: household, factor_type: "totp", status: "verified" }] });
  const result = await AppLayout({ children: null });
  expect(JSON.stringify(result)).toContain("Verify your account security");
  expect(records.at(-1)?.meta).toMatchObject({ outcome: "failure" });
  expect(records.some(r => (r.meta?.phases as string[] | undefined)?.includes("shell_read"))).toBe(false);
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|00000000/);
});

it.each([[1, "memberships"], [2, "memberships"], [3, "admission_before"], [4, "admission_after_factors"], [5, "option_read"], [6, "admission_after_task"], [7, "admission_before"], [8, "admission_after_factors"], [9, "shell_read"], [10, "admission_after_task"]] as const)("preserves acquisition failure at transaction %s and identifies %s", async (at, phase) => {
  failAt = at;
  await expect(AppLayout({ children: null })).rejects.toBe(failure);
  const failed = records.find(r => r.event === "dashboard.render_transaction" && r.meta?.outcome === "acquisition_failed");
  expect(failed).toMatchObject({ meta: { code: "P2028", execution_ms: null } });
  expect(failed?.meta?.phases).toContain(phase);
  expect(records.at(-1)).toMatchObject({ event: "dashboard.render_complete", meta: { outcome: "failure", failure_phase: phase, code: "P2028" } });
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|00000000|customer@example|SELECT/);
});

it("records provider failure without serializing its error and leaves unrelated layouts silent", async () => {
  state.factors.mockRejectedValueOnce(new Error("PRIVATE provider response token"));
  await expect(AppLayout({ children: null })).rejects.toThrow("PRIVATE");
  expect(records.at(-1)?.meta).toMatchObject({ outcome: "failure", failure_phase: "provider_factors" });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  records.length = 0; state.headers.delete(DASHBOARD_RENDER_HEADER);
  await AppLayout({ children: null });
  expect(records).toHaveLength(0);
});
