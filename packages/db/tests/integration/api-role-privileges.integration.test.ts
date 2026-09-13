import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { adminClient, bootstrapDatabase } from "./setup.js";
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
