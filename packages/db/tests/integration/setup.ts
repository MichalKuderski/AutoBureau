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
 *
 * WHY THERE IS A PREFLIGHT
 * ------------------------
 * These defaults used to say `localhost:54329`, and for a whole session the suite
 * scored 12/12 against the wrong server: a stray PostgreSQL 18 instance held both
 * specific loopback addresses on that port, and a specific bind beats docker's
 * wildcard one, so every `localhost` connection went to it instead of the pg16
 * container. Nothing failed, because nothing checked. Two lessons are encoded below:
 *
 *   1. `127.0.0.1`, never `localhost` — on macOS the latter resolves to ::1 first,
 *      which is a different listener from the IPv4 one.
 *   2. Assert what answered. A test suite that cannot say which server it proved
 *      something about has not proved it.
 */

export const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  "postgresql://autobureau:local_dev_only@127.0.0.1:55432/autobureau";

export const APP_URL =
  process.env.DATABASE_URL ?? "postgresql://app_user:app_local_only@127.0.0.1:55432/autobureau";

/** CI pins pgvector/pgvector:pg16; local compose uses the same image. */
const EXPECTED_MAJOR = Number(process.env.DATABASE_EXPECTED_MAJOR ?? "16");

/** Host, port and database only — a connection string carries a password. */
function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "<unparseable DATABASE URL>";
  }
}

/**
 * Fail loudly when the server answering is not the one the suite is meant to prove
 * things about. A wrong-server run must never be able to report success.
 */
async function assertExpectedServer(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    const [row] = await admin.$queryRawUnsafe<
      Array<{ version_num: string; database: string; port: number; has_vector: boolean }>
    >(`SELECT current_setting('server_version_num') AS version_num,
              current_database()                    AS database,
              inet_server_port()                    AS port,
              EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS has_vector`);

    if (!row) throw new Error("preflight query returned no rows");
    const major = Math.floor(Number(row.version_num) / 10_000);

    console.log(
      `[integration] ${endpointOf(ADMIN_URL)} · PostgreSQL ${major} · db=${row.database} · port=${row.port}`,
    );

    if (major !== EXPECTED_MAJOR) {
      throw new Error(
        `Integration tests target PostgreSQL ${EXPECTED_MAJOR} (CI pins pgvector/pgvector:pg16) but ` +
          `${endpointOf(ADMIN_URL)} answered with PostgreSQL ${major}. Something else is listening on ` +
          `that port — check \`lsof -nP -iTCP:${new URL(ADMIN_URL).port} -sTCP:LISTEN\`. Run \`pnpm db:up\`, ` +
          `or set DATABASE_ADMIN_URL/DATABASE_URL to the intended server.`,
      );
    }
    if (!row.has_vector) {
      throw new Error(
        `${endpointOf(ADMIN_URL)} has no pgvector extension available; the schema requires it. ` +
          `This is almost certainly not the pgvector/pgvector:pg16 container.`,
      );
    }
  } finally {
    await admin.$disconnect();
  }
}

export async function bootstrapDatabase(): Promise<void> {
  await assertExpectedServer();
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
    const dbName = new URL(ADMIN_URL).pathname.replace(/^\//, "");
    await admin.$executeRawUnsafe(`ALTER ROLE app_user WITH LOGIN PASSWORD 'app_local_only'`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO app_user`);
  } finally {
    await admin.$disconnect();
  }
}

export function adminClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
}
