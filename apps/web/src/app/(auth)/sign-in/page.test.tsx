import { describe, expect, it } from "vitest";
import SignInPage from "./page";

/**
 * Blueprint P0-13 — the entry half of the guard.
 *
 * `sign-in-form.test.tsx` proves the form refuses a hostile destination handed to it
 * directly. This file proves the other end: that a hostile `?next=` never becomes a
 * prop in the first place. Both call the one `safeDestination`; neither reimplements
 * it. The split matters because either check alone would be a single point of failure,
 * and the same entry-and-exit shape already guards the PKCE destination (P0-06).
 *
 * `SignInPage` is an async server component, so it is awaited directly and its
 * returned element inspected — no DOM, no router, nothing mocked.
 */

async function destinationFor(next: string | string[] | undefined): Promise<string> {
  const element = await SignInPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  });
  return (element.props as { next: string }).next;
}

describe("a valid destination reaches the form intact", () => {
  it("passes an internal path straight through", async () => {
    expect(await destinationFor("/obligations")).toBe("/obligations");
  });

  it("preserves a query string on that path", async () => {
    expect(await destinationFor("/obligations?member=m-1")).toBe("/obligations?member=m-1");
  });

  it("preserves a nested path", async () => {
    expect(await destinationFor("/obligations/o-1")).toBe("/obligations/o-1");
  });
});

describe("an absent destination becomes the existing default", () => {
  it("defaults when no next is present at all", async () => {
    expect(await destinationFor(undefined)).toBe("/dashboard");
  });

  it("defaults for an empty next", async () => {
    expect(await destinationFor("")).toBe("/dashboard");
  });
});

describe("a hostile destination never becomes a prop", () => {
  it.each([
    ["absolute https URL", "https://evil.example/pwn"],
    ["absolute http URL", "http://evil.example/pwn"],
    ["protocol-relative", "//evil.example"],
    ["backslash escape", "/\\evil.example"],
    ["mixed backslash", "/obligations\\..\\evil"],
    ["newline control character", "/obligations\n"],
    ["null control character", "/obligations\u0000"],
    ["delete control character", "/obligations\u007f"],
    ["the refresh route itself", "/auth/refresh"],
    ["the refresh route with a trailing slash", "/auth/refresh/"],
    ["the refresh route carrying its own next", "/auth/refresh?next=/obligations"],
    ["a bare scheme", "javascript:alert(1)"],
    ["no leading slash", "evil.example"],
  ])("%s becomes /dashboard", async (_label, hostile) => {
    expect(await destinationFor(hostile)).toBe("/dashboard");
  });
});

describe("a repeated next parameter is refused rather than guessed at", () => {
  it("treats an array as no destination", async () => {
    // `?next=/obligations&next=//evil.example` arrives as an array. Picking either one
    // is a guess, and guessing wrong is how a redirect slips past a reviewer who only
    // read the first value.
    expect(await destinationFor(["/obligations", "//evil.example"])).toBe("/dashboard");
  });

  it("treats even an all-benign array as no destination", async () => {
    expect(await destinationFor(["/obligations", "/documents"])).toBe("/dashboard");
  });
});
