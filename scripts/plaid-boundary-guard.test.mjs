import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const imports=s=>[...s.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map(x=>x[1]).sort();
const ambient=s=>/\b(?:fetch|eval|Function|WebSocket|XMLHttpRequest|require)\s*\(|\bimport\s*\(|\b(?:process|globalThis|console)\s*[.[]/.test(s);
const files=p=>readdirSync(resolve(root,p),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${p}/${e.name}`):/\.[jt]sx?$/.test(e.name)?[`${p}/${e.name}`]:[]);
test('local financial custody remains dependency-free, synthetic-only and without ambient authority',()=>{
 const s=read('services/plaid/src/local-custody.ts');assert.deepEqual(imports(s),['node:crypto']);assert.equal(ambient(s),false);
 assert.deepEqual(JSON.parse(read('services/plaid/package.json')).dependencies??{},{});
 for(const weakened of ['fetch("https://example.test")','console.log(token)','process.env.KEY','import("node:fs")'])assert.equal(ambient(s+'\n'+weakened),true);
 assert.notDeepEqual(imports(s+'\nimport db from "@autobureau/db"'),['node:crypto']);
});
test('ordinary app, document/model and database modules cannot import the financial decrypt seam',()=>{
 const all=[...files('apps/web/src'),...files('packages/db/src'),...files('services/ai/src')].filter(p=>!p.endsWith('.test.ts')&&!p.endsWith('.test.tsx'));
 assert.deepEqual(all.filter(p=>/@autobureau\/plaid-boundary|services\/plaid|local-custody/.test(read(p))),[]);
});
