import { PrismaClient } from "@prisma/client";

/**
 * Web integration harness.
 *
 * Deliberately stricter than the `packages/db` harness in one respect: there are no
 * fallback connection strings here. That package's defaults are guarded by a preflight
 * that prints and asserts what answered, so they cannot be silently wrong — but a second
 * harness with its own copy of a default URL is a second thing to keep in sync, and the
 * consequence of drift is a suite that proves nothing while reporting green. This one
 * fails closed instead.
 *
 * Schema creation is NOT done here. `packages/db` owns migrations, and turbo runs its
 * integration task first (`dependsOn: ["^test:integration"]`), so two suites can never
 * race on `prisma migrate deploy` — a race that already bit once.
 */

/** CI pins pgvector/pgvector:pg16; local compose uses the same image. */
const EXPECTED_MAJOR = Number(process.env["DATABASE_EXPECTED_MAJOR"] ?? "16");

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${key} is not set. The web integration suite will not guess a database.\n` +
        `  pnpm db:up\n` +
        `  export DATABASE_ADMIN_URL="postgresql://autobureau:local_dev_only@127.0.0.1:55432/autobureau"\n` +
        `  export DATABASE_URL="postgresql://app_user:app_local_only@127.0.0.1:55432/autobureau"`,
    );
  }
  return value.trim();
}

export const ADMIN_URL = (): string => requiredEnv("DATABASE_ADMIN_URL");
export const APP_URL = (): string => requiredEnv("DATABASE_URL");

/** Host, port and database only — a connection string carries a password. */
function endpointOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
}

/**
 * Fail loudly when the server answering is not the one the suite is meant to prove
 * things about, and say which one it was. A suite that cannot name the server it
 * exercised has not proved anything about production.
 */
export async function assertExpectedServer(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL() } } });
  try {
    const [row] = await admin.$queryRawUnsafe<
      Array<{ version_num: string; database: string; has_schema: boolean }>
    >(`SELECT current_setting('server_version_num') AS version_num,
              current_database() AS database,
              EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'household_users') AS has_schema`);
    if (!row) throw new Error("preflight query returned no rows");

    const major = Math.floor(Number(row.version_num) / 10_000);
    console.log(
      `[web:integration] ${endpointOf(ADMIN_URL())} · PostgreSQL ${major} · db=${row.database}`,
    );

    if (major !== EXPECTED_MAJOR) {
      throw new Error(
        `Integration tests target PostgreSQL ${EXPECTED_MAJOR} but ${endpointOf(ADMIN_URL())} ` +
          `answered with PostgreSQL ${major}.`,
      );
    }
    if (!row.has_schema) {
      throw new Error(
        `${endpointOf(ADMIN_URL())} has no schema. Migrations are owned by packages/db — ` +
          `run \`pnpm test:integration\` from the repository root, or ` +
          `\`pnpm --filter @autobureau/db db:migrate\` first.`,
      );
    }
  } finally {
    await admin.$disconnect();
  }
}

export function adminClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: ADMIN_URL() } } });
}

/** `app_user` needs LOGIN for tests; in production Supabase owns this role. */
export async function grantAppUserLogin(): Promise<void> {
  const admin = adminClient();
  try {
    const dbName = new URL(ADMIN_URL()).pathname.replace(/^\//, "");
    await admin.$executeRawUnsafe(`ALTER ROLE app_user WITH LOGIN PASSWORD 'app_local_only'`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO app_user`);
  } finally {
    await admin.$disconnect();
  }
}
