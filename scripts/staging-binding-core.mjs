import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadInventory, snapshot, assertPhaseSchema} from './rejection-rollout-core.mjs';

// All reads share one read-only, repeatable snapshot. No migration adapter is used.
export async function readOnly(db, inspect) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5s'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='2s'");
    await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout='10s'");
    const [mode] = await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only')='on' AS readonly");
    if (mode?.readonly !== true) throw Error('Read-only refused');
    return inspect(sql => tx.$queryRawUnsafe(sql));
  }, {isolationLevel:'RepeatableRead',maxWait:5000,timeout:15000});
}
export async function inspectBinding({root, db, report}) {
  const manifest = JSON.parse(await readFile(join(root,'scripts/rejection-rollout-manifest.json'),'utf8'));
  const {local} = await loadInventory(root,manifest);
  if (Object.keys(manifest.baseline).length !== 48 ||
      Object.entries(manifest.baseline).some(([name,checksum]) => local[name] !== checksum))
    throw Error('Local inventory refused');
  await readOnly(db, async read => {
    report(0); // Authenticated and read-only mode confirmed, not merely URL parsing.
    const [identity] = await read(`SELECT current_database()='postgres' AS database_ok,
      current_user='postgres' AND session_user='postgres' AS role_ok,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin) AS login_ok`);
    if (!identity?.database_ok || !identity.role_ok || !identity.login_ok) throw Error('Identity refused');
    report(1);
    const rows = await read('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name LIMIT 49');
    if (rows.length !== 48 || new Set(rows.map(r => r.migration_name)).size !== 48 ||
        rows.some(r => !r.finished_at || r.rolled_back_at || manifest.baseline[r.migration_name] !== r.checksum))
      throw Error('Ledger refused');
    report(2);
    assertPhaseSchema(await snapshot(read),'pause',false);
    report(3);
  });
}
