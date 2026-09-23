import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {reviewJournalRetirement,JOURNAL_CLASSES,RETIREMENT_DEPENDENCIES} from '../src/journal-retirement.js';
const now=new Date('2026-09-21T12:00:00Z');
function input(){const closed={state:'closed',reference:randomUUID(),validUntil:'2026-09-21T12:05:00Z'};return{version:1,householdId:randomUUID(),deletionId:randomUUID(),operationId:randomUUID(),journalClass:'processing',snapshotAt:now.toISOString(),leaseUntil:null,fenced:true,count:1,dependencies:Object.fromEntries(['replay','accounting','provider','content','restore','audit'].map(k=>[k,{...closed}])),hold:{state:'clear',authorizationId:randomUUID(),reviewBy:'2026-09-21T12:05:00Z'}};}
it.each(JOURNAL_CLASSES)('%s needs every dependency, never grants operational authority',journalClass=>{const r={...input(),journalClass};expect(reviewJournalRetirement(r,now)).toMatchObject({status:'ready-for-independent-review',operationalRetirementAuthorized:false,finalReceiptIssuable:false});for(const key of RETIREMENT_DEPENDENCIES[journalClass])expect(reviewJournalRetirement({...r,dependencies:{...r.dependencies,[key]:{...r.dependencies[key],state:'unknown'}}},now).blockers).toContain(key);});
it.each(['active','unknown','expired'])('hold %s cannot silently become clearance',state=>{const r=input();r.hold.state=state==='expired'?'clear':state;if(state==='expired')r.hold.reviewBy=now.toISOString();expect(reviewJournalRetirement(r,now).blockers).toContain('incident-hold-unresolved');});
it('rejects unbounded, unknown and content-bearing reviews',()=>{const r=input();for(const bad of [{...r,count:101},{...r,count:-1},{...r,journalClass:'unknown'},{...r,payload:'content'},{...r,dependencies:{}}])expect(()=>reviewJournalRetirement(bad,now)).toThrow();});
it('does not accept expired evidence or an active lease without a fence',()=>{const r=input();r.fenced=false;r.leaseUntil='2026-09-21T12:01:00Z';r.dependencies.restore!.validUntil=now.toISOString();expect(reviewJournalRetirement(r,now).blockers).toEqual(['deletion-fence','active-lease','restore']);});
it('machine catalog agrees with every class dependency and preserves non-authorization',async()=>{
 const {readFile}=await import('node:fs/promises');const catalog=JSON.parse(await readFile(new URL('../../../docs/engineering/journal-retirement-catalog.json',import.meta.url),'utf8'));
 expect(catalog.classes.map((c:{id:string})=>c.id)).toEqual([...JOURNAL_CLASSES]);
 for(const c of catalog.classes)expect(c.dependencies).toEqual(RETIREMENT_DEPENDENCIES[c.id as keyof typeof RETIREMENT_DEPENDENCIES]);
 expect(catalog.operationalRetirementAuthorized).toBe(false);expect(catalog.finalReceiptIssuable).toBe(false);
});
