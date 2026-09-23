import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'packages/db/prisma/migrations');
const preflight=readFileSync(resolve(root,'packages/db/prisma/preflight/upgrade-preflight.sql'),'utf8');
const migrations=()=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>[e.name,readFileSync(resolve(dir,e.name,'migration.sql'),'utf8')]);
// Top-level DO blocks that RAISE on application data (not catalog/metadata drift) stop a chain mid-way.
function dataRefusals(sql){return [...sql.matchAll(/^DO \$\$[\s\S]*?END \$\$;/gm)].map(m=>m[0]).filter(b=>/RAISE EXCEPTION/.test(b)&&/\bFROM\s+(?!pg_)(?:public\.)?[a-z_]+/.test(b)&&!/to_regprocedure|pg_proc/.test(b));}
function unguardedRoles(sql){return [...sql.matchAll(/^CREATE ROLE ([a-z_]+)/gm)].map(m=>m[1]);}
function unregistered(list){const missing=[];for(const [name,sql] of list){
 if(dataRefusals(sql).length&&!preflight.includes(`--   ${name}`))missing.push(name);
 for(const role of unguardedRoles(sql))if(!new RegExp(`--   ${name} .*\\b${role}\\b`).test(preflight))missing.push(`${name}:${role}`);}
 return missing;}
test('every data-refusing or role-creating migration is registered in the read-only upgrade preflight',()=>{
 assert.deepEqual(unregistered(migrations()),[]);
 assert.ok(dataRefusals(migrations().find(([n])=>n==='20260925000000_processing_custody')[1]).length===1);
 // Negative controls: an unregistered data refusal or new role must be caught.
 assert.deepEqual(unregistered([['29990101000000_future','DO $$ BEGIN IF EXISTS(SELECT 1 FROM items) THEN RAISE EXCEPTION \'x\'; END IF; END $$;']]),['29990101000000_future']);
 assert.deepEqual(unregistered([['29990101000001_role','CREATE ROLE app_future NOLOGIN;']]),['29990101000001_role:app_future']);
});
test('the preflight is a single read-only statement',()=>{
 const body=preflight.replace(/--.*$/gm,'');
 assert.equal((body.match(/;/g)??[]).length,1);
 assert.doesNotMatch(body,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|COPY|SET|LOCK|CALL|DO)\b/i);
});
