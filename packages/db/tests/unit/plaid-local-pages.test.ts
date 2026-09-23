import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {collapseLocalPlaidPages,LOCAL_PLAID_SYNC_BOUNDS,type LocalPlaidSyncPage,type LocalPlaidTransaction} from '../../src/plaid-local-lifecycle.js';

const acct='public-fixture-account-'+randomUUID();
const t=(amountCents=-1,over:Partial<LocalPlaidTransaction>={}):LocalPlaidTransaction=>({transactionId:'public-fixture-txn-'+randomUUID(),accountId:acct,amountCents,date:'2026-09-01',description:'PUBLIC purchase',pending:false,...over});
const page=(p:Partial<LocalPlaidSyncPage>={}):LocalPlaidSyncPage=>({accounts:[],added:[],modified:[],removed:[],nextCursor:'c',hasMore:false,...p});
const refused='Local financial operation refused';

describe('collapseLocalPlaidPages',()=>{
 it('applies sequential deltas: the last event for a transaction wins, including removal and re-add',()=>{const a=t(),b=t(),c=t();
  const out=collapseLocalPlaidPages([page({added:[a,b,c],hasMore:true,nextCursor:'1'}),page({modified:[{...a,amountCents:-9}],removed:[b.transactionId],hasMore:true,nextCursor:'2'}),page({removed:[c.transactionId],added:[b],nextCursor:'3'})]);
  expect(out.nextCursor).toBe('3');expect(out.removed).toEqual([c.transactionId]);
  expect(out.upserts.map(x=>[x.transactionId,x.amountCents])).toEqual([[a.transactionId,-9],[b.transactionId,-1]]);
 });
 it('keeps the latest account snapshot and bounds accounts, pages and per-page changes',()=>{
  const snap=(n:number)=>({accountId:acct,name:`PUBLIC ${n}`,kind:'depository' as const,currentCents:n,availableCents:null});
  expect(collapseLocalPlaidPages([page({accounts:[snap(1)],hasMore:true,nextCursor:'1'}),page({accounts:[snap(2)]})]).accounts).toEqual([snap(2)]);
  expect(()=>collapseLocalPlaidPages(Array.from({length:LOCAL_PLAID_SYNC_BOUNDS.pages+1},(_,i)=>page({hasMore:i<LOCAL_PLAID_SYNC_BOUNDS.pages})))).toThrow(refused);
  expect(()=>collapseLocalPlaidPages([page({added:Array.from({length:LOCAL_PLAID_SYNC_BOUNDS.changesPerPage+1},()=>t())})])).toThrow(refused);
  expect(()=>collapseLocalPlaidPages([page({accounts:Array.from({length:LOCAL_PLAID_SYNC_BOUNDS.accounts+1},()=>({...snap(1),accountId:'public-fixture-account-'+randomUUID()}))})])).toThrow(refused);
  expect(()=>collapseLocalPlaidPages([])).toThrow(refused);
 });
 it.each([
  ['float money',[page({added:[t(-1.5)]})]],['unsafe integer',[page({added:[t(2**60)]})]],['impossible date',[page({added:[t(-1,{date:'2026-02-30'})]})]],
  ['control characters',[page({added:[t(-1,{description:'bad\u0000text'})]})]],['real-shaped id',[page({added:[t(-1,{transactionId:'abc123'})]})]],
  ['extra key',[{...page(),note:'x'}]],['missing key',[{accounts:[],added:[],modified:[],removed:[],nextCursor:'c'}]],
  ['has-more on last page',[page({hasMore:true})]],['no has-more before last',[page(),page()]],['cursor grammar',[page({nextCursor:'bad cursor'})]],
  ['overlong cursor',[page({nextCursor:'a'.repeat(257)})]],['prototype object',[Object.assign(Object.create({polluted:true}),page())]],
 ])('refuses %s without partial output',(_name,pages)=>{expect(()=>collapseLocalPlaidPages(pages)).toThrow(refused);});
});
