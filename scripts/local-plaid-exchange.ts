import type {Database} from '../packages/db/src/scoped.js';
import {claimLocalPlaidExchange,completeLocalPlaidExchange} from '../packages/db/src/plaid-local-exchange.js';
import {createLocalPlaidCustody} from '../services/plaid/src/local-custody.js';
/** Local deterministic composition only; never mounted/imported by the application.
 * A fixture adapter is injected; no provider SDK, credentials, env or network access.
 * The first DB transaction closes before exchange/seal; a second publishes ciphertext. */
export async function runLocalPlaidExchange(db:Database,householdId:string,operationId:string,publicToken:string,
 keyring:ReturnType<typeof createLocalPlaidCustody>,provider:{exchange:(token:string)=>Promise<{itemId:string;accessToken:string}>}){
 if(!/^public-sandbox-PUBLIC_SYNTHETIC_[a-f0-9-]{36}$/.test(publicToken))throw new Error('Local financial operation refused');
 const claim=await claimLocalPlaidExchange(db,householdId,operationId);if(!claim)return{status:'not-claimable' as const};
 try{const result=await provider.exchange(publicToken);
  const binding={environment:'local-synthetic-sandbox' as const,householdId,incarnationId:claim.incarnationId,itemId:operationId,providerItemId:result.itemId,revision:1};
  const envelope=keyring.seal(binding,result.accessToken);
  return{status:'completed' as const,...await completeLocalPlaidExchange(db,claim,result.itemId,envelope)};
 }catch{throw new Error('Local financial operation refused');}
}
