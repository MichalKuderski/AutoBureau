// Refuse a misplaced migration credential before Prisma can connect. Never print
// the credential, parsed username, hostname, password or an exception containing it.
import {migrationConnection} from './staging-migration-trust.mjs';
let allowed = false;
try {
  migrationConnection(process.env.DATABASE_URL);
  allowed = true;
} catch { /* Invalid configuration is a refusal, not a credential-bearing error. */ }
if (!allowed) {
  process.stderr.write('Refusing migration: the configured connection is not the approved staging project and session/direct endpoint.\n');
  process.exitCode = 1;
} else process.stdout.write('Approved staging migration target verified.\n');
