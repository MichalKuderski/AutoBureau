import {diagnosticCaPath} from './staging-binding-ca.mjs';
// This diagnostic is deliberately pinned to the known pre-migration baseline.
export const project = 'kdqnfruwgocfqwpbpuxo';
export function authority(env) {
  return env.GITHUB_REPOSITORY === 'MichalKuderski/AutoBureau' &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main' &&
    env.GITHUB_ACTOR === 'MichalKuderski' && env.GITHUB_TRIGGERING_ACTOR === 'MichalKuderski' &&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
    env.DIAGNOSTIC_APPROVAL === `diagnostic:${env.GITHUB_SHA}:${project}`;
}
export function connection(input) {
  const u = new URL(input);
  const direct = u.hostname === `db.${project}.supabase.co` && decodeURIComponent(u.username) === 'postgres';
  const session = u.hostname === 'aws-0-us-west-2.pooler.supabase.com' && decodeURIComponent(u.username) === `postgres.${project}`;
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !(direct || session) ||
      (u.port || '5432') !== '5432' || u.pathname !== '/postgres' || !u.password || u.hash)
    throw Error('Routing refused');
  // Reject routing overrides, unknown options, duplicates and permissive TLS options.
  const allowed = {schema: /^public$/, sslmode: /^require$/, sslaccept: /^strict$/,
    connection_limit: /^\d+$/, connect_timeout: /^\d+$/, pool_timeout: /^\d+$/, pgbouncer: /^false$/};
  const seen = new Set();
  for (const [key, value] of u.searchParams) {
    if (seen.has(key) || (key==='sslcert'?value!==diagnosticCaPath:!allowed[key]?.test(value))) throw Error('Options refused');
    seen.add(key);
  }
  // Only validated routing and password survive; impose bounded client settings.
  u.search = ''; u.protocol = 'postgresql:'; u.port = '5432';
  for (const [k,v] of Object.entries({schema:'public',sslmode:'require',sslaccept:'strict',sslcert:diagnosticCaPath,
    connection_limit:'1',connect_timeout:'5',pool_timeout:'5'})) u.searchParams.set(k,v);
  return u.toString();
}
