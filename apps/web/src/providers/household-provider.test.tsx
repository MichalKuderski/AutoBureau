// @vitest-environment-options { "url": "https://app.autobureau.test/" }
//
// The selection cookie is written with `Secure`, matching the session cookies and their
// stated reasoning. A document served over plain http rejects such a cookie silently, so
// the test origin is https — the alternative would have been dropping `Secure` to suit
// the test runner, which is the wrong direction entirely.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/active-household";
import { resetActiveHousehold } from "@/lib/api-client";
import { HouseholdProvider, useHousehold, type ActiveHousehold } from "./household-provider";

/**
 * Active-household selection, from the client's side (blueprint P1-03).
 *
 * The property under test is the one the provider's own header claims: switching is a
 * navigation, not a setState. So selecting B must write a preference and ask the server
 * to re-render — and must *not* make this provider start reporting B, because only the
 * server gets to decide that.
 */

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));

// Only the reload is stubbed; `writeActiveHousehold` stays real, so the cookie assertions
// below are about the actual cookie this code writes.
vi.mock("@/lib/active-household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/active-household")>()),
  reloadForHousehold: reload,
}));

const A = "0192f5a1-0000-7000-8000-0000000000a1";
const B = "0192f5a1-0000-7000-8000-0000000000b1";

const household = (id: string, name: string): ActiveHousehold => ({
  id,
  name,
  role: "owner",
  timezone: "America/Denver",
  locale: "en-US",
  emailAlias: null,
  members: [],
  plan: "free",
});

const VIEWER = { id: "u-1", displayName: "Dana", email: "dana@example.test" };

function Probe() {
  const { household: active, households, select } = useHousehold();
  return (
    <div>
      <p data-testid="active">{active.name}</p>
      <p data-testid="count">{households.length}</p>
      {households.map((option) => (
        <button key={option.id} type="button" onClick={() => select(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

function renderProvider(households?: { id: string; name: string }[]) {
  return render(
    <HouseholdProvider household={household(A, "Household A")} viewer={VIEWER} households={households}>
      <Probe />
    </HouseholdProvider>,
  );
}

const cookieValue = (): string | undefined =>
  document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACTIVE_HOUSEHOLD_COOKIE}=`))
    ?.split("=")[1];

beforeEach(() => {
  reload.mockClear();
  resetActiveHousehold();
  document.cookie = `${ACTIVE_HOUSEHOLD_COOKIE}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  resetActiveHousehold();
});

describe("one household needs no selection", () => {
  it("reports a single option and names nothing to the API client", () => {
    renderProvider();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("active")).toHaveTextContent("Household A");
  });

  it("selecting the household already active writes nothing and refreshes nothing", async () => {
    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "Household A" }));
    expect(cookieValue()).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("several households offer the choice", () => {
  const OPTIONS = [
    { id: A, name: "Household A" },
    { id: B, name: "Household B" },
  ];

  it("exposes every membership the server enumerated", () => {
    renderProvider(OPTIONS);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Household B" })).toBeInTheDocument();
  });

  it("selecting B persists the preference and asks the server to re-decide", async () => {
    renderProvider(OPTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Household B" }));

    // Persisted somewhere a document navigation will carry — not React state.
    expect(cookieValue()).toBe(B);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does NOT start claiming B is active — only the server decides that", async () => {
    renderProvider(OPTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Household B" }));

    // The whole point. If the provider swapped locally, a selection the server refuses
    // would leave the UI naming a household the person cannot see.
    expect(screen.getByTestId("active")).toHaveTextContent("Household A");
  });

  it("reflects B only once the server hands B back", () => {
    render(
      <HouseholdProvider household={household(B, "Household B")} viewer={VIEWER} households={OPTIONS}>
        <Probe />
      </HouseholdProvider>,
    );
    expect(screen.getByTestId("active")).toHaveTextContent("Household B");
  });

  it("the persisted preference survives a re-render, which is what a refresh replays", async () => {
    const { unmount } = renderProvider(OPTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Household B" }));
    unmount();

    // A fresh mount reads nothing from memory; the cookie is the only carrier.
    expect(cookieValue()).toBe(B);
  });
});
