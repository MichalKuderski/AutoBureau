// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const script = fileURLToPath(new URL("../../../../../scripts/verify-staging-migration-target.mjs", import.meta.url));
const secret = "credential-canary-never-log";
describe("staging migration target guard", () => {
  it.each([
    `postgresql://postgres:${secret}@db.kdqnfruwgocfqwpbpuxo.supabase.co:5432/postgres`,
    `postgresql://postgres.kdqnfruwgocfqwpbpuxo:${secret}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  ])("accepts a staging session/direct connection without printing its parts", (url) => {
    expect(execFileSync(process.execPath, [script], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" })).toBe("Approved staging migration target verified.\n");
  });
  it.each([
    "", "invalid", `postgresql://postgres:${secret}@db.production-project.supabase.co/postgres`,
    `postgresql://postgres.production-project:${secret}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.kdqnfruwgocfqwpbpuxo:${secret}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.kdqnfruwgocfqwpbpuxo:${secret}@attacker.example.test:5432/postgres`,
  ])("refuses an unverified target without exposing credentials", (url) => {
    let output = "";
    try { execFileSync(process.execPath, [script], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", stdio: "pipe" }); }
    catch (error) { const result = error as { status: number; stderr: string }; expect(result.status).toBe(1); output = result.stderr; }
    expect(output).toContain("Refusing migration"); expect(output).not.toContain(secret); expect(output).not.toContain(url || "DATABASE_URL=");
  });
});
