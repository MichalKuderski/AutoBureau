import type { Route } from "next";

/**
 * Typed-route escape hatch — the *only* sanctioned one.
 *
 * Next validates `href` against the statically known route table, which is exactly
 * what we want for hand-written links: a typo in `/obligations` fails the build.
 * But a meaningful share of this product's navigation is data-derived — an API
 * response hands us `/obligations/0192f5a1-…` and no static analysis can verify it.
 *
 * Scattering `as Route` at each of those call sites would erode the guarantee
 * everywhere it still applies. Funnelling them through one named function keeps the
 * cast greppable, documents why it exists, and leaves every literal link fully
 * checked.
 *
 * Rule: only for paths the server produced. Never for a literal — write the literal.
 */
export function dynamicHref(path: string): Route {
  return path as Route;
}
