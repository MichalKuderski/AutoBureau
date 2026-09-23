// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createGoTrueProvider } from "@/server/auth/provider";
import { getDatabase } from "@/server/db";

vi.mock("@/server/auth/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/provider")>()),
  createGoTrueProvider: vi.fn(),
}));
vi.mock("@/server/db", () => ({ getDatabase: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("does not propagate an unredeemed confirmation credential when auth configuration is missing", async () => {
  vi.stubEnv("AUTH_COOKIE_NAME", undefined);
  const response = await GET(
    new Request(
      "https://app.example.test/auth/confirm?token_hash=unredeemed-secret&type=email&next=https://evil.example/",
    ),
  );

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://app.example.test/sign-in");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toHaveLength(0);
  expect(await response.text()).not.toContain("unredeemed-secret");
  expect(createGoTrueProvider).not.toHaveBeenCalled();
  expect(getDatabase).not.toHaveBeenCalled();
});
