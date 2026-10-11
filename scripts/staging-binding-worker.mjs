// Fixed hosted entrypoint: no SQL, phase, factory or local-target inputs.
import {fileURLToPath} from 'node:url';
import {connection} from './staging-binding-policy.mjs';
import {createClient} from './staging-binding-client.mjs';
import {executeDiagnostic} from './staging-binding-core.mjs';
const send=event=>new Promise((resolve,reject)=>process.send(event,error=>error?reject(Error('IPC failed')):resolve()));
try {
  const ok=await executeDiagnostic({root:fileURLToPath(new URL('..',import.meta.url)),
    createClient:()=>createClient(connection(process.env.DATABASE_URL)),report:send});
  process.exit(ok?0:1);
} catch {process.exit(1);}
