import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadInventory, snapshot, assertPhaseSchema} from './rejection-rollout-core.mjs';
import {reasons,structuredReason} from './staging-binding-protocol.mjs';

// All reads share one read-only, repeatable snapshot. No migration adapter is used.
export async function readOnly(db, inspect) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5s'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='2s'");
    await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout='10s'");
    const [mode] = await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only')='on' AS readonly");
    if (mode?.readonly !== true) throw new Refusal('READ_ONLY_FAILURE');
    return inspect(sql => tx.$queryRawUnsafe(sql));
  }, {isolationLevel:'RepeatableRead',maxWait:5000,timeout:15000});
}
class Refusal extends Error {
  constructor(reason) {super('Diagnostic refused');this.reason=reason;}
}
export async function loadBaseline(root) {
  const manifest=JSON.parse(await readFile(join(root,'scripts/rejection-rollout-manifest.json'),'utf8'));
  const {local}=await loadInventory(root,manifest);
  if(Object.keys(manifest.baseline).length!==48 ||
    Object.entries(manifest.baseline).some(([name,checksum])=>local[name]!==checksum))
    throw new Refusal('LOCAL_SETUP_FAILURE');
  return manifest;
}
// Dependency adapters exist only at this module boundary for synthetic tests.
// The hosted worker supplies a fixed root, real client and checked connection.
export async function executeDiagnostic({root,createClient,report}) {
  let db,manifest,active=null;
  const start=async n=>{active=n;await report([n,0,0]);};
  const pass=async n=>{await report([n,1,0]);active=null;};
  const step=async(n,fn)=>{await start(n);await fn();await pass(n);};
  try {
    await step(0,async()=>{manifest=await loadBaseline(root);db=await createClient();});
    await step(1,()=>db.$connect());
    await start(2);
    await readOnly(db,async read=>{
      await pass(2);
      await step(3,async()=>{
        const [identity]=await read(`SELECT current_database()='postgres' AS database_ok,
          current_user='postgres' AND session_user='postgres' AS role_ok,
          EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin) AS login_ok`);
        if(!identity?.database_ok || !identity.role_ok || !identity.login_ok) throw new Refusal('IDENTITY_MISMATCH');
      });
      await step(4,async()=>{
        const rows=await read('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name LIMIT 49');
        if(rows.length!==48 || new Set(rows.map(r=>r.migration_name)).size!==48 ||
          rows.some(r=>!r.finished_at || r.rolled_back_at || manifest.baseline[r.migration_name]!==r.checksum))
          throw new Refusal('LEDGER_MISMATCH');
      });
      await step(5,async()=>{
        const posture=await snapshot(read);
        try {assertPhaseSchema(posture,'pause',false);} catch {throw new Refusal('SCHEMA_MISMATCH');}
      });
      await start(6);
    });
    await pass(6); // Only after the read-only transaction actually finishes.
    await step(7,()=>db.$disconnect());
    return true;
  } catch(error) {
    if(active!==null) {
      const code=structuredReason(error);
      const reason=error instanceof Refusal?error.reason:code!=='UNKNOWN'?code:active===0?'LOCAL_SETUP_FAILURE':'UNKNOWN';
      await report([active,2,reasons.indexOf(reason)]);
    }
    try {await db?.$disconnect();} catch { /* No raw cleanup output. Supervisor still bounds wall time. */ }
    return false;
  }
}
