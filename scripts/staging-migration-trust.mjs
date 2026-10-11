import {fileURLToPath} from 'node:url';
import {verifyDiagnosticCa} from './staging-binding-ca.mjs';
import {connection} from './staging-binding-policy.mjs';

// Reuse the reviewed CA pins and exact routing/TLS policy. Phase authority stays
// in rejection-rollout-plan.mjs; no trust path, pin or local-target override exists.
export function migrationConnection(input) {
  verifyDiagnosticCa();
  return connection(input);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {verifyDiagnosticCa();process.stdout.write('MIGRATION_CA PASS\n');}
  catch {process.stdout.write('MIGRATION_CA FAIL\n');process.exitCode=1;}
}
