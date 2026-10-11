import {authority,connection} from './staging-binding-policy.mjs';
import {supervise} from './staging-binding-supervisor.mjs';
import {blankResults,formatResults} from './staging-binding-protocol.mjs';
let auth='FAIL',routing='NOT_RUN';
let outcome={ok:false,reason:'NOT_RUN',results:blankResults()};
try {
  if(authority(process.env)) {
    auth='PASS';routing='FAIL';
    const databaseUrl=connection(process.env.DATABASE_URL);
    routing='PASS';
    // No inherited debug/preload, telemetry, token or provider environment in driver.
    outcome=await supervise(new URL('./staging-binding-worker.mjs',import.meta.url),
      {DATABASE_URL:databaseUrl,NODE_ENV:'production'});
  }
} catch { /* No exception/input serialization. Failed routing never starts a worker. */ }
process.stdout.write(formatResults(auth,routing,outcome));
process.exitCode=outcome.ok?0:1;
