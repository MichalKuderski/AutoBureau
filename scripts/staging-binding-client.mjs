import {createRequire} from 'node:module';
// Shared real generated-client construction, exercised by local subprocess tests.
export function createClient(datasourceUrl) {
  const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
  const {PrismaClient}=require('@prisma/client');
  return new PrismaClient({datasourceUrl,log:[]});
}
