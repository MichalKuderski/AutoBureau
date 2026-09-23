// @vitest-environment-options { "url": "https://app.autobureau.test/" }
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/active-household";
import { HouseholdProvider, type ActiveHousehold } from "@/providers/household-provider";
import { SidebarNav } from "./nav";
import { HouseholdChooser } from "./household-chooser";

/**
 * The switcher and the chooser (blueprint P1-03).
 *
 * Two surfaces, one rule: neither reports a household the server has not already
 * resolved. The switcher shows the active one and offers the alternatives; the chooser
 * exists for the case where there is no active one yet because the resolver refused to
 * guess between several memberships.
 */

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));

vi.mock("@/lib/active-household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/active-household")>()),
  reloadForHousehold: reload,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
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
  members: [{ id: "m-1", displayName: "Dana", kind: "adult" }],
  plan: "free",
});

const VIEWER = { id: "u-1", displayName: "Dana", email: "dana@example.test" };

function renderNav(households?: { id: string; name: string }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HouseholdProvider household={household(A, "Household A")} viewer={VIEWER} households={households}>
        <ToastProvider>
          <SidebarNav />
        </ToastProvider>
      </HouseholdProvider>
    </QueryClientProvider>,
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
  document.cookie = `${ACTIVE_HOUSEHOLD_COOKIE}=; Max-Age=0; Path=/`;
});

describe("one household is a label, not a control", () => {
  it("offers no selector at all", () => {
    renderNav();
    expect(screen.queryByRole("combobox", { name: /active household/i })).not.toBeInTheDocument();
    // The name still shows — as text. (It appears twice in the sidebar: the switcher
    // block and the profile link, which both name the household.)
    expect(screen.getAllByText("Household A").length).toBeGreaterThan(0);
  });
});

describe("several households can be switched between", () => {
  const OPTIONS = [
    { id: A, name: "Household A" },
    { id: B, name: "Household B" },
  ];

  it("offers a labelled selector showing the active household", () => {
    renderNav(OPTIONS);
    const selector = screen.getByRole("combobox", { name: /active household/i });
    expect(selector).toHaveValue(A);
    expect(screen.getByRole("option", { name: "Household B" })).toBeInTheDocument();
  });

  it("choosing B persists the preference and re-renders from the server", async () => {
    renderNav(OPTIONS);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /active household/i }), B);

    expect(cookieValue()).toBe(B);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still shows A as active until the server says otherwise", async () => {
    renderNav(OPTIONS);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /active household/i }), B);
    // The selector's value comes from the server-resolved household, not from the click.
    expect(screen.getByRole("combobox", { name: /active household/i })).toHaveValue(A);
  });
});

describe("the chooser answers the ambiguity the resolver refuses to guess at", () => {
  it("lists every membership and names no active household", () => {
    render(<HouseholdChooser households={[{ id: A, name: "Household A" }, { id: B, name: "Household B" }]} />);
    expect(screen.getByRole("heading", { name: /which household/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household B" })).toBeInTheDocument();
  });

  it("choosing one persists it and reloads", async () => {
    render(<HouseholdChooser households={[{ id: A, name: "Household A" }, { id: B, name: "Household B" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Household B" }));

    expect(cookieValue()).toBe(B);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("renders no application shell — there is no household to render one for", () => {
    render(<HouseholdChooser households={[{ id: A, name: "Household A" }]} />);
    expect(screen.queryByRole("navigation", { name: /main/i })).not.toBeInTheDocument();
  });
});
