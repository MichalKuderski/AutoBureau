import {authority,connection} from './staging-binding-policy.mjs';
import {supervise} from './staging-binding-supervisor.mjs';
const names=['AUTHORITY','ROUTING','AUTHENTICATION','DATABASE_ROLE','MIGRATION_CHECKSUMS','SCHEMA_POSTURE','TRANSACTION_COMPLETED'];
const results=names.map(()=>false);
try {
  if (!authority(process.env)) throw Error('Authority refused');
  results[0]=true;
  const databaseUrl=connection(process.env.DATABASE_URL);
  results[1]=true;
  // No inherited debug/preload, telemetry, token or provider environment in driver.
  const outcome=await supervise(new URL('./staging-binding-worker.mjs',import.meta.url),
    {DATABASE_URL:databaseUrl,NODE_ENV:'production'});
  for(let i=0;i<outcome.count;i++)results[i+2]=true;
  results[6]=outcome.ok;
} catch { /* Never serialize an exception or any input. */ }
for(let i=0;i<names.length;i++) process.stdout.write(`${names[i]} ${results[i]?'PASS':'FAIL'}\n`);
process.exitCode=results.every(Boolean)?0:1;
