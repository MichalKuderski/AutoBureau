/** Read only the deployment currently assigned to the fixed stable-staging domain.
 * CI's existing Vercel read credential is used; no browser login, build or promotion.
 */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { stagingApi, snapshot, assertUnchanged, PROJECT, TEAM } from './staging-stable-oidc-proof.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const events = new Set(['auth.not_configured', 'auth.sign_in_failed', 'auth.sign_in_error', 'auth.sign_in_provider_unavailable', 'auth.sign_up_provider_unavailable']);

export function projectAuthRecords(stdout) {
  const records = [], seen = new Set();
  function inspect(value, depth = 0) {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
    if (events.has(value.event) && uuid.test(value.trace_id ?? '')) {
      const key = `${value.event}:${value.trace_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        const meta = value.meta;
        records.push({ event: value.event, traceId: value.trace_id,
          ...(Number.isInteger(value.status) && value.status >= 100 && value.status < 600 ? { status: value.status } : {}),
          ...(Number.isInteger(meta?.upstream_status) && meta.upstream_status >= 100 && meta.upstream_status < 600 ? { upstreamStatus: meta.upstream_status } : {}),
          ...(['http', 'timeout', 'network', 'invalid-response'].includes(meta?.upstream_failure) ? { upstreamFailure: meta.upstream_failure } : {}),
          ...(Number.isInteger(meta?.upstream_duration_ms) && meta.upstream_duration_ms >= 0 && meta.upstream_duration_ms <= 600_000 ? { upstreamDurationMs: meta.upstream_duration_ms } : {}),
          ...(uuid.test(meta?.upstream_request_id ?? '') ? { upstreamRequestId: meta.upstream_request_id } : {}) });
      }
    }
    for (const key of ['message', 'logs', 'entries']) {
      const nested = value[key];
      if (typeof nested === 'string') { try { inspect(JSON.parse(nested), depth + 1); } catch { /* Never retain raw logs. */ } }
      else if (nested && typeof nested === 'object') inspect(nested, depth + 1);
    }
  }
  for (const line of stdout.split('\n')) { try { inspect(JSON.parse(line)); } catch { /* CLI progress is not evidence. */ } }
  return records;
}

export async function readStableAuthDiagnostics({ env = process.env, request = fetch, runCli = spawnSync } = {}) {
  const api = stagingApi(env, request);
  const before = await snapshot(path => api(path, 'GET'));
  const deploymentId = before.stable.deploymentId;
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error('STOP: invalid stable deployment ID');
  // The CLI gets both an exact project and the independently resolved deployment;
  // no branch fallback, no team-wide query, no separate Production application.
  const result = runCli('vercel', ['logs', '--project', PROJECT, '--deployment', deploymentId,
    '--scope', TEAM, '--environment', 'production', '--since', '2h', '--level', 'error',
    '--json', '--expand', '--limit', '100', '--no-follow'], {
    encoding: 'utf8', timeout: 45_000, maxBuffer: 1_000_000,
    env: { ...env, VERCEL_PROJECT_ID: PROJECT, VERCEL_ORG_ID: TEAM, VERCEL_TELEMETRY_DISABLED: '1' },
  });
  const after = await snapshot(path => api(path, 'GET'));
  assertUnchanged(before, after);
  return { capturedAt: new Date().toISOString(), scope: 'stable staging', before, after,
    stableAssignmentUnchanged: true, productionApplicationAccessed: false,
    cliSucceeded: result.status === 0, records: projectAuthRecords(result.stdout ?? ''),
    limitation: 'An empty record list is not proof of provider health or root-cause closure. Raw logs and credentials are not retained.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await readStableAuthDiagnostics();
    await writeFile('staging-auth-diagnostics.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(evidence) + '\n');
    if (!evidence.cliSucceeded) process.exitCode = 1;
  } catch { console.error('Staging auth readback failed; raw provider output withheld'); process.exitCode = 1; }
}
