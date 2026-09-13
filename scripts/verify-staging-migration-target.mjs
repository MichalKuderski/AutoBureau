// Refuse a misplaced migration credential before Prisma can connect. Never print
// the credential, parsed username, hostname, password or an exception containing it.
const project = 'kdqnfruwgocfqwpbpuxo';
let allowed = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const port = url.port || '5432';
  const direct = url.hostname === `db.${project}.supabase.co` && decodeURIComponent(url.username) === 'postgres';
  const sessionPool = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${project}`;
  allowed = ['postgres:', 'postgresql:'].includes(url.protocol) && port === '5432' && url.pathname === '/postgres' && (direct || sessionPool);
} catch { /* Invalid configuration is a refusal, not a credential-bearing error. */ }
if (!allowed) {
  process.stderr.write('Refusing migration: the configured connection is not the approved staging project and session/direct endpoint.\n');
  process.exitCode = 1;
} else process.stdout.write('Approved staging migration target verified.\n');
