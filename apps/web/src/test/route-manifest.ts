import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The application's real page-route manifest, read from `src/app` itself.
 *
 * Blueprint P0-14 exists because a UI component's `href` and the actual route tree
 * can drift silently — `dynamicHref` deliberately opts a string out of Next's own
 * `typedRoutes` checking, so nothing at compile time catches `/documents/${id}` when
 * no such page exists. This is the check that has to happen instead, and it reads the
 * same directory Next itself reads rather than a second, hand-maintained list of
 * routes that could drift from the first one exactly the way the UI already did.
 *
 * Route groups (`(app)`, `(auth)`) contribute no path segment, matching Next's own
 * routing rules. Only `page.tsx` presence makes a directory a route; a bare `route.ts`
 * (an API handler under `/v1` or `/auth`) is deliberately not a page route and is
 * excluded, since no UI component under audit ever links to one of those.
 */

const APP_DIR = join(import.meta.dirname, "../app");

function collect(dir: string, prefix: string): string[] {
  const routes: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) {
    routes.push(prefix === "" ? "/" : prefix);
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // Route groups: `(app)`, `(auth)` — real, but contribute no segment.
    if (entry.startsWith("(") && entry.endsWith(")")) {
      routes.push(...collect(full, prefix));
      continue;
    }
    // Private/API/asset directories never hold a `page.tsx` a UI link would target.
    if (entry.startsWith("_") || entry === "api") continue;
    routes.push(...collect(full, `${prefix}/${entry}`));
  }
  return routes;
}

/** Every real page route, e.g. `/obligations/[id]`, dynamic segments unresolved. */
export function appPageRoutes(): string[] {
  return collect(APP_DIR, "");
}

/**
 * Whether `path` (an internal path, its query string ignored) resolves to a route
 * `appPageRoutes()` actually contains — `/obligations/o-4` matches `/obligations/[id]`,
 * `/documents/d-7` matches nothing, because nothing declares that segment count and
 * shape with a dynamic final part.
 */
export function matchesKnownRoute(path: string, routes: string[] = appPageRoutes()): boolean {
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  return routes.some((route) => {
    const routeSegments = route.split("/").filter(Boolean);
    if (routeSegments.length !== segments.length) return false;
    return routeSegments.every((seg, i) => seg.startsWith("[") || seg === segments[i]);
  });
}
