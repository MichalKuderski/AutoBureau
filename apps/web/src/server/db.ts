import { createDatabase, type Database } from "@autobureau/db";

/**
 * The application's database handle.
 *
 * One per runtime instance, created lazily. Two handles would mean two connection
 * pools competing for the same transaction-mode pooler, which is how a serverless
 * deployment discovers its connection limit in production rather than in review.
 *
 * `DATABASE_URL` is the `app_user` connection and nothing else. There is no privileged
 * fallback here on purpose: doc 06 §5 confines `service_role` to migrations and two
 * named jobs, and a request path that could reach for it under load would defeat both
 * walls at once.
 */

export class DatabaseConfigError extends Error {
  override readonly name = "DatabaseConfigError";
}

let cached: Database | undefined;

export function getDatabase(): Database {
  if (cached) return cached;
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") {
    throw new DatabaseConfigError("DATABASE_URL is not set.");
  }
  cached = createDatabase(url);
  return cached;
}

/** Test seam: the module-level handle would otherwise outlive an environment change. */
export function resetDatabase(): void {
  cached = undefined;
}
