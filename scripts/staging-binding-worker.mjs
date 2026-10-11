// Fixed hosted worker, never accepts SQL, callbacks, local target or phase inputs.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {inspectBinding} from './staging-binding-core.mjs';
import {connection} from './staging-binding-policy.mjs';
let db;
try {
  const datasourceUrl=connection(process.env.DATABASE_URL);
  const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
  const {PrismaClient}=require('@prisma/client');
  db=new PrismaClient({datasourceUrl,log:[]});
  await inspectBinding({root:fileURLToPath(new URL('..',import.meta.url)),db,report:n=>process.send(n)});
  await db.$disconnect();
  process.exit(0);
} catch {
  // Even disconnect errors and native crash output cannot reach the supervisor log.
  try {await db?.$disconnect();} catch { /* fixed failure only */ }
  process.exit(1);
}
