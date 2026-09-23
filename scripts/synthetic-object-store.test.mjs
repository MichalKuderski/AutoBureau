import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,cpSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {syntheticObjectStore} from './synthetic-object-store.mjs';
function fixture(t) {const root=realpathSync(mkdtempSync(join(tmpdir(),'pellum-synthetic-'))); t.after(()=>rmSync(root,{recursive:true,force:true}));return{root,store:syntheticObjectStore(root),hh:randomUUID(),doc:randomUUID(),seal:randomUUID()};}
test('immutable quarantine seal is exact, independently copied and cannot be overwritten',async t=>{
 const f=fixture(t),bytes=Buffer.from('PUBLIC SYNTHETIC');f.store.put('quarantine',f.hh,f.doc,bytes);f.store.seal(f.hh,f.doc,f.seal);bytes.fill(0);
 const loader=f.store.snapshots(f.hh);assert.equal((await loader.load({documentId:f.doc,sealId:f.seal,size:16},new AbortController().signal)).toString(),'PUBLIC SYNTHETIC');
 assert.throws(()=>f.store.seal(f.hh,f.doc,f.seal));
 await assert.rejects(loader.load({documentId:f.doc,sealId:randomUUID(),size:16},new AbortController().signal));
 await assert.rejects(f.store.snapshots(randomUUID()).load({documentId:f.doc,sealId:f.seal,size:16},new AbortController().signal));
});
test('delete acknowledgement is separate from an independent instance observing every namespace',t=>{
 const f=fixture(t);f.store.put('quarantine',f.hh,f.doc,Buffer.from('PUBLIC'));f.store.seal(f.hh,f.doc,f.seal);
 for(const c of ['job-artifacts','export-artifacts'])f.store.put(c,f.hh,randomUUID(),Buffer.from('PUBLIC'));
 assert.throws(()=>f.store.erase('objects',f.hh));f.store.fence(f.hh);
 const observer=syntheticObjectStore(f.root);
 for(const c of ['objects','quarantine','job-artifacts','export-artifacts']){
 assert.equal(observer.observe(c,f.hh).state,'remaining');assert.equal(f.store.erase(c,f.hh).absenceProven,false);
 assert.equal(observer.observe(c,f.hh).state,'absent');assert.equal(f.store.erase(c,f.hh).count,0);}
});
test('old data snapshot cannot reactivate a fenced household; malformed/missing ledger is not proof',async t=>{
 const f=fixture(t);f.store.put('quarantine',f.hh,f.doc,Buffer.from('PUBLIC'));f.store.seal(f.hh,f.doc,f.seal);
 const backup=join(f.root,'backup');cpSync(join(f.root,'data'),backup,{recursive:true});
 f.store.fence(f.hh);f.store.erase('objects',f.hh);f.store.erase('quarantine',f.hh);cpSync(backup,join(f.root,'data'),{recursive:true});
 const restored=syntheticObjectStore(f.root);assert.equal(restored.restoreGate([f.hh]).activationAllowed,false);
 assert.equal(restored.observe('objects',f.hh).state,'remaining');
 await assert.rejects(restored.snapshots(f.hh).load({documentId:f.doc,sealId:f.seal,size:6},new AbortController().signal));
 assert.throws(()=>restored.put('quarantine',f.hh,randomUUID(),Buffer.from('PUBLIC')));
 assert.equal(restored.restoreGate(['../escape']).activationAllowed,false);
});
test('path traversal, unknown names and symlinks fail closed without deleting their targets',t=>{
 const f=fixture(t);assert.throws(()=>f.store.put('quarantine','../outside',f.doc,Buffer.from('PUBLIC')));
 f.store.put('quarantine',f.hh,f.doc,Buffer.from('PUBLIC'));f.store.fence(f.hh);
 const evil=join(f.root,'data','quarantine',f.hh,randomUUID());symlinkSync(join(f.root,'fences',f.hh),evil);
 assert.equal(syntheticObjectStore(f.root).observe('quarantine',f.hh).state,'unknown');assert.throws(()=>f.store.erase('quarantine',f.hh));
 assert.equal(readFileSync(join(f.root,'fences',f.hh),'utf8'),'FENCED1\n');
});
test('the synthetic admission composition accepts application UUIDv7 and still rejects malformed names',async t=>{
 const f=fixture(t),doc='00000000-0000-7000-8000-000000000001',seal='00000000-0000-7000-8000-000000000002';
 f.store.put('quarantine',f.hh,doc,Buffer.from('PUBLIC'));f.store.seal(f.hh,doc,seal);
 assert.equal((await f.store.snapshots(f.hh).load({documentId:doc,sealId:seal,size:6},new AbortController().signal)).toString(),'PUBLIC');
 assert.throws(()=>f.store.put('quarantine',f.hh,doc+'/../escape',Buffer.from('PUBLIC')));
});
