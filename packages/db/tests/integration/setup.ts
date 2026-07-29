import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

/**
 * Integration-test bootstrap. Requires the local stack: `pnpm db:up`.
 *
 * Two connections, deliberately:
 *   ADMIN — the superuser that owns the tables. Bypasses RLS, so it can seed
 *           fixtures across households. Never used for assertions.
 *   APP   — `app_user`: not superuser, not table owner, so RLS genuinely applies.
 *           Every assertion runs here. If a test passes on ADMIN it proves nothing.
 */

export const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  "postgresql://autobureau:local_dev_only@localhost:54329/autobureau";

export const APP_URL =
  process.env.DATABASE_URL ??
  "postgresql://app_user:app_local_only@localhost:54329/autobureau";

export function bootstrapDatabase(): void {
  // fileURLToPath, not URL.pathname: the latter percent-encodes, so any checkout
  // path containing a space resolves to a directory that does not exist.
  execSync("pnpm exec prisma migrate deploy", {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, DATABASE_URL: ADMIN_URL },
    stdio: "pipe",
  });
}

/** Give app_user a password/LOGIN for tests. In production Supabase owns this role. */
export async function grantAppUserLogin(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    await admin.$executeRawUnsafe(`ALTER ROLE app_user WITH LOGIN PASSWORD 'app_local_only'`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE autobureau TO app_user`);
  } finally {
    await admin.$disconnect();
  }
}

export function adminClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
}
