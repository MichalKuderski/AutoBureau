// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * ADR-010 — the other half of the nonce correlation.
 *
 * `middleware.csp.test.ts` proves the header the browser enforces and the `x-nonce` the
 * layout is handed are the same value. This proves the layout actually puts that value on
 * the theme script, rather than rendering a script the policy will block. Together they
 * close the loop that the old "CSP is nonce-based" comment only asserted.
 *
 * The layout is an async server component, so it is awaited directly and its element tree
 * inspected — no DOM, and no need to render `<html>` into a document that already has one.
 */

const headerStore = { value: null as string | null };

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers(headerStore.value === null ? {} : { "x-nonce": headerStore.value })),
}));

async function renderLayout(nonce: string | null): Promise<ReactElement> {
  headerStore.value = nonce;
  const { default: RootLayout } = await import("./layout");
  return (await RootLayout({ children: null })) as ReactElement;
}

/** The `<script>` element the layout renders into `<head>`. */
function themeScript(tree: ReactElement): Record<string, unknown> {
  const html = tree.props as { children: ReactElement[] };
  const head = html.children.find((child) => child?.type === "head");
  expect(head, "no <head> in the root layout").toBeDefined();
  const headChildren = (head?.props as { children: unknown }).children;
  const nodes = Array.isArray(headChildren) ? headChildren : [headChildren];
  const script = nodes.find(
    (node): node is ReactElement => typeof node === "object" && node !== null && (node as ReactElement).type === "script",
  );
  expect(script, "no inline <script> in <head>").toBeDefined();
  return (script as ReactElement).props as Record<string, unknown>;
}

describe("Test C · the theme script is stamped with the request's nonce", () => {
  it("uses exactly the value from the x-nonce header", async () => {
    const props = themeScript(await renderLayout("t3stNonceValue+/=="));
    expect(props["nonce"]).toBe("t3stNonceValue+/==");
  });

  it("takes a different nonce on a different request", async () => {
    expect(themeScript(await renderLayout("first-nonce"))["nonce"]).toBe("first-nonce");
    expect(themeScript(await renderLayout("second-nonce"))["nonce"]).toBe("second-nonce");
  });

  it("still renders the theme bootstrap itself, not just the attribute", async () => {
    const props = themeScript(await renderLayout("n"));
    const html = (props["dangerouslySetInnerHTML"] as { __html: string }).__html;
    expect(html).toContain("autobureau.theme");
    expect(html).toContain("data-theme");
  });

  it("suppresses hydration warnings on that script", async () => {
    // Browsers blank the nonce content attribute after parsing, so hydration compares the
    // server's value against "" and reports a mismatch on every page. Removing this makes
    // every page log a hydration error; the assertion is here so that removal is noticed.
    expect(themeScript(await renderLayout("n"))["suppressHydrationWarning"]).toBe(true);
  });

  it("omits the attribute rather than emitting nonce=\"null\" when no header is present", async () => {
    expect(themeScript(await renderLayout(null))["nonce"]).toBeUndefined();
  });
});
