import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { CSRF_HEADER } from "@/lib/csrf";
import { SignInForm } from "./sign-in-form";

/**
 * Blueprint P0-05 and P0-06 — the same page, two separate lies.
 *
 * P0-05: "Continue with Google" and "Continue with Apple" rendered as ordinary,
 * trustworthy buttons and did `router.push(next)` on click — no request, no provider, no
 * session. With the real middleware active the user would be bounced straight back to
 * sign-in.
 *
 * P0-06: the magic-link path `setTimeout`ed for 500ms and then announced "We've sent a
 * sign-in link to …". No request was made; `POST /v1/auth/magic-link` had existed,
 * PKCE and all, since before the screen was written.
 *
 * The question the P0-06 assertions answer is therefore not "does the confirmation
 * appear" — it always did, which was the defect — but whether it can appear without the
 * server having accepted the request. Every success assertion below is paired with the
 * response that caused it.
 */

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

/** 204 is the endpoint's only success, and it carries no body. */
const NO_CONTENT = (): Response => new Response(null, { status: 204 });

const PROBLEM = (status: number, detail: string): Response =>
  new Response(
    JSON.stringify({
      type: "https://autobureau.com/problems/unavailable",
      title: "Temporarily unavailable — try again shortly.",
      status,
      detail,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(NO_CONTENT()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LINK_MODE = /email me a one-time link instead/i;
const SEND_LINK = /email me a sign-in link/i;

async function requestLink(address: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: LINK_MODE }));
  await userEvent.type(screen.getByLabelText("Email"), address);
  await userEvent.click(screen.getByRole("button", { name: SEND_LINK }));
}

/** The one call `apiFetch` made, as `[url, init]`. */
function lastRequest(): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

describe("Test A · no non-functional OAuth controls", () => {
  it("renders no Google or Apple sign-in control", () => {
    renderScreen(<SignInForm />);

    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apple/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with apple/i)).not.toBeInTheDocument();
  });

  it("carries no leftover divider with nothing left to divide", () => {
    renderScreen(<SignInForm />);
    // The "or" divider existed only to separate the form from the OAuth section.
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });
});

describe("Test B · working authentication remains", () => {
  it("still renders the password sign-in path", () => {
    renderScreen(<SignInForm />);

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /forgot your password/i })).toBeInTheDocument();
  });

  it("still offers the magic-link path", () => {
    renderScreen(<SignInForm />);
    expect(
      screen.getByRole("button", { name: /email me a one-time link instead/i }),
    ).toBeInTheDocument();
  });

  it("still links to sign-up", () => {
    renderScreen(<SignInForm />);
    expect(screen.getByRole("link", { name: /create an account/i })).toBeInTheDocument();
  });
});

describe("Test C · no dead OAuth handler remains", () => {
  it("has no click target anywhere on the page that navigates without authenticating", () => {
    renderScreen(<SignInForm />);

    // Every remaining button on the page is accounted for by the working paths: the
    // submit button, the password/link mode toggle. None navigates on click alone —
    // the router mock is only ever touched by the real sign-in submission, and this
    // test never submits, so it must still be untouched.
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    const buttonNames = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttonNames.some((name) => /google|apple/i.test(name ?? ""))).toBe(false);
  });
});

describe("P0-06 Test A · the request is actually sent", () => {
  it("posts to the magic-link endpoint with the CSRF header apiFetch owns", async () => {
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = lastRequest();
    expect(url).toBe("/v1/auth/magic-link");
    expect(init.method).toBe("POST");
    // Not re-implemented in the component: the point of routing through the one HTTP
    // door is that a screen cannot forget the header the endpoint refuses without.
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe("1");
    // Without this the Set-Cookie carrying the PKCE verifier is dropped and the emailed
    // link has nothing to redeem against.
    expect(init.credentials).toBe("same-origin");
  });

  it("sends the trimmed address, and only the fields the endpoint's schema accepts", async () => {
    renderScreen(<SignInForm />);
    await requestLink("  someone@example.test  ");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = lastRequest();
    expect(JSON.parse(init.body as string)).toEqual({ email: "someone@example.test" });
  });

  it("does not send anything until the form is submitted", async () => {
    renderScreen(<SignInForm />);
    await userEvent.click(screen.getByRole("button", { name: LINK_MODE }));
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed address without reaching the network", async () => {
    renderScreen(<SignInForm />);
    await requestLink("not-an-address");

    // Two gates stand in front of the request and this value fails the outer one: the
    // field is `type="email"` on a form without `noValidate`, so the browser's own
    // constraint validation blocks submission before `submit()` runs at all. The
    // property that matters either way is that nothing was sent.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /check your email/i })).not.toBeInTheDocument();
  });

  it("refuses an address the browser accepts but we don't, and says so", async () => {
    // `a@b` satisfies HTML5 email validation, which does not require a dot, so this is
    // the case that actually exercises the form's own check and its message.
    renderScreen(<SignInForm />);
    await requestLink("a@b");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/enter the address you signed up with/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /check your email/i })).not.toBeInTheDocument();
  });
});

describe("P0-06 Test B · the confirmation follows the server, not a timer", () => {
  it("shows the confirmation with the submitted address once the endpoint answers 204", async () => {
    renderScreen(<SignInForm />);
    await requestLink("  someone@example.test  ");

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    // The address as displayed matches the address as sent — the trimmed one.
    expect(screen.getByText("someone@example.test")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't send the link/i)).not.toBeInTheDocument();
  });

  it("waits for the response — no elapsed time produces a confirmation on its own", async () => {
    // The exact defect: the old branch resolved on a 500ms `setTimeout`. With a request
    // that never settles, any surviving timer would surface the confirmation anyway.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(screen.queryByRole("heading", { name: /check your email/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/we've sent a sign-in link/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SEND_LINK })).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the 'use a password instead' recovery path, on a working form", async () => {
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");
    await screen.findByRole("heading", { name: /check your email/i });

    await userEvent.click(screen.getByRole("button", { name: /use a password instead/i }));

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // `pending` is cleared before the confirmation renders, so the button coming back is
    // a live one rather than a spinner left over from the request that succeeded.
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
  });
});

describe("P0-06 Test C · a failure is never dressed as a sent email", () => {
  it.each([
    ["the provider is unreachable", () => PROBLEM(503, "Sign-in is briefly unavailable.")],
    ["too many attempts", () => PROBLEM(429, "Too many attempts — try again shortly.")],
    ["the request could not be verified", () => PROBLEM(403, "This request could not be verified.")],
    ["the network is down", () => Promise.reject(new TypeError("network"))],
  ])("%s → no confirmation, and the reason is stated", async (_label, outcome) => {
    fetchMock.mockImplementation(() => outcome());
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");

    expect(await screen.findByText(/we couldn't send the link/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /check your email/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/we've sent a sign-in link/i)).not.toBeInTheDocument();
  });

  it("leaves the form usable so the request can be retried", async () => {
    fetchMock.mockImplementation(() => PROBLEM(503, "Sign-in is briefly unavailable."));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");
    await screen.findByText(/we couldn't send the link/i);

    const button = screen.getByRole("button", { name: SEND_LINK });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy", "true");

    fetchMock.mockImplementation(() => Promise.resolve(NO_CONTENT()));
    await userEvent.click(button);

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces no provider detail, status code, or infrastructure noise", async () => {
    fetchMock.mockImplementation(() => PROBLEM(503, "Sign-in is briefly unavailable."));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");
    await screen.findByText(/we couldn't send the link/i);

    const page = document.body.textContent ?? "";
    // The endpoint's own `detail` is the most the user is ever shown. Anything the
    // provider said about the address stops at `provider.ts`, which never surfaces it.
    expect(page).not.toMatch(/gotrue|supabase|apikey|otp|user not found|invalid_grant/i);
    expect(page).not.toMatch(/\b(?:401|403|429|500|503)\b/);
  });

  it("clears the failure when the user switches back to the password path", async () => {
    fetchMock.mockImplementation(() => PROBLEM(503, "Sign-in is briefly unavailable."));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");
    await screen.findByText(/we couldn't send the link/i);

    await userEvent.click(screen.getByRole("button", { name: /sign in with a password instead/i }));

    // Otherwise the link path's failure sits under the password path's heading.
    expect(screen.queryByText(/we couldn't send the link/i)).not.toBeInTheDocument();
  });
});

describe("P0-06 Test D · the client adds no enumeration the endpoint refused to", () => {
  it("answers identically for an address the provider knows and one it does not", async () => {
    // The endpoint returns 204 either way — a rejected address is swallowed on purpose,
    // because "no such account" would make it a membership oracle. So the two runs are
    // literally the same response, and the screens must be literally the same screen.
    const screens: string[] = [];
    for (const address of ["known@example.test", "unknown@example.test"]) {
      const { unmount } = renderScreen(<SignInForm />);
      await requestLink(address);
      await screen.findByRole("heading", { name: /check your email/i });
      screens.push((document.body.textContent ?? "").replace(address, "{address}"));
      unmount();
    }

    expect(screens[0]).toBe(screens[1]);
  });

  it("never claims an address is or is not registered", async () => {
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");
    await screen.findByRole("heading", { name: /check your email/i });

    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/not registered|no account|unknown address|doesn't exist|no such/i);
    // "We've sent" is the endpoint's own framing of a 204: the request was accepted.
    // Nothing on the screen speaks to whether an inbox received anything.
    expect(page).toMatch(/we've sent a sign-in link/i);
  });
});

describe("P0-06 Test E · one press, one email", () => {
  it("issues a single request however many times the button is pressed", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");

    const button = screen.getByRole("button", { name: SEND_LINK });
    await userEvent.click(button);
    await userEvent.click(button);

    // A second request would overwrite the first request's verifier cookie, quietly
    // killing the link already in the user's inbox.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds the same line for keyboard submission", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignInForm />);
    await userEvent.click(screen.getByRole("button", { name: LINK_MODE }));

    const field = screen.getByLabelText("Email");
    await userEvent.type(field, "someone@example.test{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.type(field, "{Enter}");
    await userEvent.type(field, "{Enter}");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("announces that it is working while the request is in flight", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignInForm />);
    await requestLink("someone@example.test");

    const button = screen.getByRole("button", { name: SEND_LINK });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("P0-06 Test F · the password path is untouched", () => {
  it("still posts credentials to the sign-in endpoint and leaves for the dashboard", async () => {
    renderScreen(<SignInForm />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = lastRequest();
    expect(url).toBe("/v1/auth/sign-in");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "someone@example.test",
      password: "correct horse battery staple",
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still refuses to submit without a password, without reaching the network", async () => {
    renderScreen(<SignInForm />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/enter your password, or ask for a one-time link/i)).toBeInTheDocument();
  });

  it("still reports a refused sign-in under its own heading, without navigating", async () => {
    fetchMock.mockImplementation(() =>
      PROBLEM(401, "That email and password don't match an account."),
    );
    renderScreen(<SignInForm />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument();
    expect(screen.getByText(/don't match an account/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * Blueprint P0-13.
 *
 * P0-12 gave an expired session a way out: `/sign-in?next=<where you were>`. The form
 * on the other end ignored it and went to `/dashboard` regardless, so the recovery link
 * recovered the session but not the task — the user still had to find their way back.
 *
 * The destination is now honoured, and every assertion below involving a hostile value
 * passes `next` straight into the component as a prop. That is deliberate: it bypasses
 * `page.tsx` entirely, so what these prove is the form's *own* guard rather than the
 * page's. The page's guard is proved separately, in `page.test.tsx`.
 */

async function signInWithPassword(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
  await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("P0-13 Test A · a valid destination is honoured", () => {
  it("lands on /obligations when that is where the user was sent from", async () => {
    renderScreen(<SignInForm next="/obligations" />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/obligations"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("P0-13 Test B · a destination's query string survives", () => {
  it("preserves the full internal path and query", async () => {
    renderScreen(<SignInForm next="/obligations?member=m-1" />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/obligations?member=m-1"));
  });
});

describe("P0-13 Test C · no destination falls back to the existing default", () => {
  it("goes to /dashboard when the prop is absent entirely", async () => {
    renderScreen(<SignInForm />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("goes to /dashboard for an empty destination", async () => {
    renderScreen(<SignInForm next="" />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});

describe("P0-13 Tests D–H · a hostile destination can never leave this origin", () => {
  it.each([
    ["absolute https URL", "https://evil.example/pwn"],
    ["absolute http URL", "http://evil.example/pwn"],
    ["protocol-relative", "//evil.example"],
    ["backslash escape", "/\\evil.example"],
    ["mixed backslash", "/obligations\\..\\evil"],
    ["newline control character", "/obligations\n"],
    ["carriage-return control character", "/obligations\r\nLocation: https://evil.example"],
    ["null control character", "/obligations\u0000"],
    ["tab control character", "/obligations\t"],
    ["delete control character", "/obligations\u007f"],
    ["the refresh route itself", "/auth/refresh"],
    ["the refresh route with a trailing slash", "/auth/refresh/"],
    ["the refresh route carrying its own next", "/auth/refresh?next=/obligations"],
    ["a bare scheme", "javascript:alert(1)"],
    ["a relative path with no leading slash", "evil.example"],
  ])("%s resolves to /dashboard", async (_label, hostile) => {
    renderScreen(<SignInForm next={hostile} />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("never hands the router anything that is not an internal path", async () => {
    renderScreen(<SignInForm next="https://evil.example/pwn" />);
    await signInWithPassword();

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const [destination] = replace.mock.calls[0] as [string];
    expect(destination.startsWith("/")).toBe(true);
    expect(destination.startsWith("//")).toBe(false);
    expect(destination).not.toContain("evil.example");
  });
});

describe("P0-13 Test I · existing authentication behaviour is untouched", () => {
  it("navigates nowhere when the credentials are refused, whatever next says", async () => {
    fetchMock.mockImplementation(() =>
      PROBLEM(401, "That email and password don't match an account."),
    );
    renderScreen(<SignInForm next="/obligations" />);
    await signInWithPassword();

    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("navigates nowhere when the request fails outright", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("network")));
    renderScreen(<SignInForm next="/obligations" />);
    await signInWithPassword();

    // `apiFetch` turns a network failure into an `ApiError` (503) carrying its own
    // detail, so the form surfaces that rather than its non-`ApiError` fallback — which
    // is unreachable through `apiFetch` by construction. What matters here either way:
    // a failure that never reached the server cannot move the user to `next`.
    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument();
    expect(screen.getByText(/check your connection/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still refuses to submit without a password, whatever next says", async () => {
    renderScreen(<SignInForm next="/obligations" />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("P0-13 Test J · the magic-link path is untouched", () => {
  it("still reaches the endpoint and still shows the confirmation", async () => {
    renderScreen(<SignInForm next="/obligations" />);
    await requestLink("someone@example.test");

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    const [url] = lastRequest();
    expect(url).toBe("/v1/auth/magic-link");
  });

  it("still sends only the address — the destination is the endpoint's own concern", async () => {
    renderScreen(<SignInForm next="/obligations" />);
    await requestLink("someone@example.test");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = lastRequest();
    // Pinned deliberately. The magic-link destination lives in the PKCE cookie the
    // endpoint sets, validated server-side on the way in and again in `/auth/callback`
    // on the way out (P0-06). P0-13 does not reach into that mechanism, and this
    // assertion is what would fail if a later change quietly started doing so.
    expect(JSON.parse(init.body as string)).toEqual({ email: "someone@example.test" });
  });

  it("does not navigate on submit — the redirect belongs to the emailed link", async () => {
    renderScreen(<SignInForm next="/obligations" />);
    await requestLink("someone@example.test");
    await screen.findByRole("heading", { name: /check your email/i });

    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
