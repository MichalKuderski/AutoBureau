import type { Metadata } from "next";
import { safeDestination } from "@/server/http/public-routes";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to AutoBureau.",
};

/**
 * Blueprint P0-13. `?next=` is validated here, on the server, before it is handed to
 * a client component — the trust boundary is the URL, so the guard belongs at the URL.
 *
 * `safeDestination` (ADR-009 D3) is the application's single open-redirect guard, the
 * same one middleware uses to *build* these links and `/auth/refresh` uses to consume
 * them. It is called, never reimplemented: nothing here re-checks for `//`, backslashes,
 * control characters, or `/auth/refresh`, because a second copy of those rules is a
 * second thing to keep correct.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // A repeated `?next=a&next=b` arrives as an array. There is no principled way to pick
  // one, and picking wrongly is how a redirect gets smuggled past a reader who only
  // checked the first — so an array is treated as no destination at all.
  return <SignInForm next={safeDestination(typeof next === "string" ? next : null)} />;
}
