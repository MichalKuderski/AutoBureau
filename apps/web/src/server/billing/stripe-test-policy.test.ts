// @vitest-environment node
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { validateStripeTestPrice, StripeTestPolicyError, type StripeTestPriceBinding } from "./stripe-test-policy";
import { createStripeTestNoticeVerifier } from "./stripe-test-notice";
const binding:StripeTestPriceBinding={plan:'monthly',priceId:'price_MonthlyTest',productId:'prod_PellumTest'};
const price={object:'price',id:binding.priceId,product:binding.productId,livemode:false,active:true,type:'recurring',currency:'usd',unit_amount:1200,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
describe('provisional Stripe TEST catalog guard',()=>{
  it('accepts the server-bound USD 12 monthly base price',()=>{const result=validateStripeTestPrice(price,binding);assert.equal(result.amountCents,1200);assert.equal(result.interval,'month');assert.equal(Object.isFrozen(result),true);});
  it('accepts the server-bound USD 99 annual base price',()=>{const result=validateStripeTestPrice({...price,unit_amount:9900,recurring:{...price.recurring,interval:'year'}},{...binding,plan:'annual'});assert.equal(result.amountCents,9900);assert.equal(result.interval,'year');});
  const invalid={live:{livemode:true},missingLive:{livemode:undefined},wrongPrice:{id:'price_Other'},wrongProduct:{product:'prod_Other'},inactive:{active:false},oneTime:{type:'one_time'},wrongCurrency:{currency:'eur'},float:{unit_amount:12.00},fraction:{unit_amount:1200.5},numericString:{unit_amount:'1200'},wrongAmount:{unit_amount:1300},tiered:{billing_scheme:'tiered'},transform:{transform_quantity:{divide_by:10}},custom:{custom_unit_amount:{}},wrongInterval:{recurring:{...price.recurring,interval:'year'}},wrongCount:{recurring:{...price.recurring,interval_count:12}},metered:{recurring:{...price.recurring,usage_type:'metered'}},deletedProduct:{product:{id:binding.productId,livemode:false,deleted:true}},expandedLiveProduct:{product:{id:binding.productId,livemode:true}}};
  for(const [name,change] of Object.entries(invalid)) it(`rejects ${name}`,()=>assert.throws(()=>validateStripeTestPrice({...price,...change},binding),StripeTestPolicyError));
  it('accepts an expanded test product without retaining metadata',()=>{const result=validateStripeTestPrice({...price,metadata:{private:'PRIVATE_CANARY'},product:{id:binding.productId,livemode:false}},binding);assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));});
  it('refuses a client-supplied non-plan key',()=>assert.throws(()=>validateStripeTestPrice(price,{...binding,plan:'__proto__'} as unknown as StripeTestPriceBinding),StripeTestPolicyError));
});
const version='2026-02-25.clover';
const config={signingSecret:'whsec_synthetic_secret_not_real',apiVersion:version,mode:'test' as const};
const event={id:'evt_Test',object:'event',livemode:false,api_version:version,created:1790000000,type:'invoice.paid',data:{object:{id:'in_Test',customer:'PRIVATE_CANARY'}}};
const raw=new TextEncoder().encode('{ "unmodified": true }');
describe('Stripe official-SDK boundary and TEST event projection',()=>{
  it('passes exact raw bytes to the injected SDK verifier before projection',()=>{let calls=0;const verify=createStripeTestNoticeVerifier((body,header,secret,tolerance)=>{calls++;assert.deepEqual(body,raw);assert.notEqual(body,raw);assert.equal(header,'signature');assert.equal(secret,config.signingSecret);assert.equal(tolerance,300);return event;},config);const result=verify(raw,'signature');assert.equal(calls,1);assert.equal(result.kind,'reconcile');assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));assert.equal(Object.isFrozen(result),true);});
  it('copies Node Buffer inputs without sharing mutable caller storage',()=>{
    const body=Buffer.from(raw); const original=Buffer.from(body);
    const verify=createStripeTestNoticeVerifier((snapshot)=>{
      assert.deepEqual(Buffer.from(snapshot),original);
      snapshot[0]=0;
      assert.deepEqual(body,original);
      return event;
    },config);
    assert.equal(verify(body,'signature').kind,'reconcile');
    assert.deepEqual(body,original);
  });
  it('refuses an SDK verification failure without keeping its exception',()=>{const verify=createStripeTestNoticeVerifier(()=>{throw new Error('PRIVATE_CANARY');},config);assert.throws(()=>verify(raw,'signature'),(e:unknown)=>{assert.ok(e instanceof StripeTestPolicyError);assert.equal('cause' in e,false);assert.ok(!String(e).includes('PRIVATE_CANARY'));return true;});});
  for(const [name,change] of Object.entries({live:{livemode:true},missingLive:{livemode:undefined},foreignVersion:{api_version:'2024-01-01'},connectedAccount:{account:'acct_Other'},thinContext:{context:'acct_Other'},missingData:{data:null},missingObjectId:{data:{object:{}}},invalidEventId:{id:'not_an_event'},invalidTimestamp:{created:0.5}})) it(`rejects ${name} even after SDK verification`,()=>{const verify=createStripeTestNoticeVerifier(()=>({...event,...change}),config);assert.throws(()=>verify(raw,'signature'),StripeTestPolicyError);});
  it('ignores authentic unrelated TEST events rather than granting an entitlement',()=>{const verify=createStripeTestNoticeVerifier(()=>({...event,type:'customer.created'}),config);assert.deepEqual(verify(raw,'signature'),{kind:'ignored',eventId:'evt_Test'});});
  for(const [name,body,header] of [['empty',new Uint8Array(),'signature'],['oversized',new Uint8Array(131073),'signature'],['missingHeader',raw,null],['hugeHeader',raw,'a'.repeat(8193)]] as const) it(`refuses ${name} before SDK invocation`,()=>{let calls=0;const verify=createStripeTestNoticeVerifier(()=>{calls++;return event;},config);assert.throws(()=>verify(body,header),StripeTestPolicyError);assert.equal(calls,0);});
  it('rejects a live-mode verifier configuration',()=>assert.throws(()=>createStripeTestNoticeVerifier(()=>event,{...config,mode:'live'} as unknown as typeof config),StripeTestPolicyError));
  it('does not suppress a duplicate notice: durable inbox deduplication remains required',()=>{const verify=createStripeTestNoticeVerifier(()=>event,config);assert.deepEqual(verify(raw,'signature'),verify(raw,'signature'));});
});
