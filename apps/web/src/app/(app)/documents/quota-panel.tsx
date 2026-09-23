"use client";
import type {DocumentQuota} from '@autobureau/contracts';
export function QuotaPanel({quota}:{quota:DocumentQuota}){
 return <section aria-labelledby="document-quota-title" className="mb-5 rounded-xl border border-line bg-surface p-4">
  <h2 id="document-quota-title" className="font-medium text-ink">Document processing</h2>
  <p>{quota.processed} of {quota.allowance} documents processed this month · {quota.plan==='premium'?'Premium':'Free'}</p>
  <p className="text-sm text-ink-secondary">{quota.reservedSlots} slots reserved · {quota.queuedClean} queued · {quota.processing} processing · {quota.needsReview} need review</p>
  {quota.warning?<p role="status">{quota.processed>=quota.allowance?'Monthly processing allowance reached.':'Approaching your monthly processing allowance.'} Queued documents are kept for review; uploading does not use a processing slot.</p>:null}
  {quota.actionRequired>0?<p role="status">{quota.actionRequired} documents need a decision before processing can continue.</p>:null}
  {quota.grace?<p role="status">Premium is in its payment grace period.</p>:null}
  <p className="text-sm text-ink-secondary">Next entitlement month: <time dateTime={quota.nextPeriod}>{quota.nextPeriod.slice(0,10)} at 00:00 UTC</time>.</p>
  <p className="text-sm text-ink-secondary">Local processing preview. Document intake remains unavailable.</p>
 </section>;
}
