/** Read-only data/role preflight before `prisma migrate deploy` (see the SQL file header).
 * Runs the checked-in statement in a READ ONLY transaction and prints only the closed
 * verdict (counts and registered reasons, never row contents or connection details).
 * Exit 1 blocks the migration step; it never attempts a repair. */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {PrismaClient}=require('@prisma/client');
const sql=await readFile(new URL('../packages/db/prisma/preflight/upgrade-preflight.sql',import.meta.url),'utf8');
const db=new PrismaClient({log:[]});
try{
 const [row]=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return tx.$queryRawUnsafe(sql.replace(/;\s*$/,''));});
 const verdict=Object.values(row)[0];
 process.stdout.write(JSON.stringify(verdict)+'\n');
 if(verdict?.ok!==true)process.exitCode=1;
}catch{process.stderr.write('Migration preflight could not run; refusing to migrate.\n');process.exitCode=1;}
finally{await db.$disconnect();}
