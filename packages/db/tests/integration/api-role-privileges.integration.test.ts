import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";
const admin = adminClient();
const sql = readFileSync(new URL("../../prisma/migrations/20260913000002_api_role_table_privileges/migration.sql", import.meta.url), "utf8");
const block = sql.slice(sql.indexOf("DO $revoke_api_tables$"), sql.lastIndexOf("COMMIT;"));
beforeAll(bootstrapDatabase, 120_000);
afterAll(() => admin.$disconnect());
it("removes inherited provider table authority, including TRUNCATE, and closes future defaults", async () => {
  const rollback = new Error("rollback exact local ACL regression fixtures");
  await expect(admin.$transaction(async (tx) => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await tx.$executeRawUnsafe(`GRANT TRUNCATE, REFERENCES, TRIGGER ON public.job_inbox TO ${role}`);
      await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}`);
    }
    await tx.$executeRawUnsafe(block);
    await tx.$executeRawUnsafe("CREATE TABLE public.adr017_acl_fixture (id integer)");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      const rows = await tx.$queryRaw<Array<{ role: string; inbox: boolean; future: boolean }>>`
        SELECT current_user AS role,
          has_table_privilege(current_user,'public.job_inbox','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS inbox,
          has_table_privilege(current_user,'public.adr017_acl_fixture','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS future`;
      expect(rows).toEqual([{ role, inbox: false, future: false }]);
      await tx.$executeRawUnsafe("SAVEPOINT denied_truncate");
      await expect(tx.$executeRawUnsafe("TRUNCATE public.job_inbox")).rejects.toThrow(/permission denied/);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT denied_truncate");
      await tx.$executeRawUnsafe("RESET ROLE");
    }
    const app = await tx.$queryRaw<Array<{ allowed: boolean }>>`SELECT has_table_privilege('app_user','public.households','SELECT,INSERT,UPDATE,DELETE') AS allowed`;
    expect(app).toEqual([{ allowed: true }]);
    throw rollback;
  }, { timeout: 30_000 })).rejects.toBe(rollback);
  expect(await admin.$queryRaw`SELECT 1 FROM pg_class WHERE relname='adr017_acl_fixture'`).toEqual([]);
});
it("no runtime role holds any authority over the migration ledger", async () => {
  // A runtime that can write the ledger can mark a pending security migration as applied,
  // and `migrate deploy` would then skip it silently. Every application role, LOGIN or not.
  const held = await admin.$queryRaw<Array<{ role: string }>>`
    SELECT r.rolname AS role FROM pg_roles r
    WHERE left(r.rolname, 4) = 'app_'
      AND has_table_privilege(r.oid, 'public._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    ORDER BY 1`;
  expect(held).toEqual([]);
  // And refused on the restricted runtime connection itself, not through an admin SET ROLE.
  await grantAppUserLogin();
  const app = new PrismaClient({ datasourceUrl: APP_URL });
  try {
    await expect(app.$queryRawUnsafe("SELECT count(*) FROM public._prisma_migrations")).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(
      "INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('forged', 'forged', '29990101000000_forged', now(), now(), 1)",
    )).rejects.toThrow(/permission denied/);
  } finally {
    await app.$disconnect();
  }
});
