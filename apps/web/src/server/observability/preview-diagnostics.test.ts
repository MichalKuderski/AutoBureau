// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let fixtureDir: string;
const script = fileURLToPath(new URL("../../../../../scripts/preview-auth-diagnostics.mjs", import.meta.url));
beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "pellum-diagnostic-test-"));
  writeFileSync(join(fixtureDir, "vercel"), `#!/usr/bin/env node
const event = { event: 'auth.sign_up_provider_unavailable', trace_id: '01234567-1234-7123-8123-0123456789ab', meta: { upstream_status: 500, email: 'PRIVATE_CANARY@example.test' }, error_message: 'PRIVATE_CANARY', cookie: 'PRIVATE_CANARY' };
console.log(JSON.stringify({message:JSON.stringify(event)}));
console.log(JSON.stringify({message:'PRIVATE_CANARY'}));
console.error('PRIVATE_CANARY');
`, { mode: 0o700 });
});
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
function run(url: string) {
  return spawnSync(process.execPath, [script, url], { encoding: "utf8", env: { ...process.env, PATH: `${fixtureDir}:${process.env.PATH}`, VERCEL_TOKEN: "PRIVATE_CANARY" } });
}
describe("Preview diagnostic output cannot become a secret/log dump", () => {
  it("prints only the numeric provider status and validated opaque trace", () => {
    const result = run("https://autobureau-staging-fixture-data-analyst-mike.vercel.app");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"upstream_status":500');
    expect(result.stdout).toContain('"records":1');
    expect(result.stdout + result.stderr).not.toContain("PRIVATE_CANARY");
  });
  it.each(["https://autobureau-staging.vercel.app", "https://autobureau.vercel.app", "https://example.com"])("refuses a non-Preview target %s", (url) => {
    const result = run(url);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("records");
    expect(result.stdout + result.stderr).not.toContain("PRIVATE_CANARY");
  });
});
