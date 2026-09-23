import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { POPULATED_ONBOARDING } from "@/test/onboarding-fixture";
import { OnboardingProvider, useOnboarding } from "./onboarding-provider";
import { HouseholdStep } from "./household-step";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/onboarding", useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function transport(fail = false) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/v1/households/current") return json({ id: POPULATED_ONBOARDING.household_id, name: "Saved household", role: "owner" });
    if (fail) return json({ status: 503, title: "Service unavailable" }, 503);
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      return json({ ...POPULATED_ONBOARDING, members: body.members });
    }
    return json(POPULATED_ONBOARDING);
  });
}

describe("setup resumes through the authenticated API", () => {
  it("loads the selected household's saved person and saves before navigating", async () => {
    const fetcher = transport(); vi.stubGlobal("fetch", fetcher);
    renderScreen(<OnboardingProvider><HouseholdStep /></OnboardingProvider>);
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Mom");
    const get = fetcher.mock.calls.find((call) => call[0] === "/v1/onboarding");
    expect((get?.[1]?.headers as Record<string, string>)["X-Household-Id"]).toBe(POPULATED_ONBOARDING.household_id);
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Parent updated");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding/census"));
    const patch = fetcher.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ stage: "household", members: [{ member_id: POPULATED_ONBOARDING.members[0]!.member_id, display_name: "Parent updated" }] });
  });
  it("reports a failed load instead of showing empty setup that could overwrite saved answers", async () => {
    vi.stubGlobal("fetch", transport(true));
    renderScreen(<OnboardingProvider><HouseholdStep /></OnboardingProvider>);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Who are you doing this for?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
});
it("lets the holder explicitly identify a new self record while preserving a saved managed person",async()=>{
 const fetcher=transport();vi.stubGlobal("fetch",fetcher);const user=userEvent.setup();
 renderScreen(<OnboardingProvider><HouseholdStep /></OnboardingProvider>);await screen.findByRole("textbox",{name:"Name"});
 await user.click(screen.getByRole("button",{name:"Add someone"}));
 await user.type(screen.getByRole("textbox",{name:"Name (person 2)"}),"PUBLIC me");
 const checks=screen.getAllByRole("checkbox",{name:"This is me (the account holder)"});expect(checks[0]).toBeDisabled();await user.click(checks[1]!);
 await user.click(screen.getByRole("button",{name:"Continue"}));await waitFor(()=>expect(push).toHaveBeenCalledWith("/onboarding/census"));
 const body=JSON.parse(String(fetcher.mock.calls.find(([,o])=>o?.method==="PATCH")![1]!.body));
 expect(body.members[0].is_self).toBe(false);expect(body.members[1]).toMatchObject({is_self:true,display_name:"PUBLIC me"});expect(body.members[1]).not.toHaveProperty("user_id");
});

function DirtyState(){return <span>{useOnboarding().dirty?"Unsaved setup":"Saved setup"}</span>;}
it("normalizes optional self flags without marking a loaded setup dirty",async()=>{
 const source={...POPULATED_ONBOARDING,members:POPULATED_ONBOARDING.members.map(m=>({is_self:false,...m}))};
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>json(String(input)==="/v1/households/current"?{id:source.household_id,name:"PUBLIC",role:"owner"}:source)));
 renderScreen(<OnboardingProvider><DirtyState /></OnboardingProvider>);expect(await screen.findByText("Saved setup")).toBeInTheDocument();
});
