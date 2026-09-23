import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
function files(dir){return readdirSync(resolve(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):/\.[cm]?[jt]sx?$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
const read=p=>readFileSync(resolve(root,p),'utf8');
const gated=/local-export-controller|createLocalExportController|account-operation-policy|local-account-routes|createLocalAccountRoutes|createRecoveryInitiator|sensitive-operation|password-policy|account-recovery-ports|stripe-test-refetch|stripe-test-state|stripe-test-reconcile|account-security(?:-ports)?|account-provider|account-recovery|local-export-artifact|stripe-test-inbox|createRecoveryController|createAccountSecurityController|createLocalExportVault|bindStripeTestSubscription|acceptStripeTestNotice|claimStripeTestNotice|readStripeTestClaim|commitStripeTestState|readStripeTestEligibility|reconcileStripeTestNotice/;
test('local foundations stay absent outside reviewed SSR and guarded local mounts',()=>{
 const bad=files('apps/web/src').filter(p=>!p.startsWith('apps/web/src/server/')&&p!=='apps/web/src/app/(app)/layout.tsx'&&p!=='apps/web/src/app/account-security/page.tsx'&&!/\.test\.[jt]sx?$/.test(p)).filter(p=>gated.test(read(p)));
 assert.deepEqual(bad,[]);
 for(const symbol of ['createRecoveryController','createAccountSecurityController','createLocalExportVault','acceptStripeTestNotice'])assert.equal(gated.test(`import { ${symbol} } from 'example'`),true);
});
test('account provider has no console logging and no automatic retry path',()=>{
 const s=read('apps/web/src/server/auth/account-provider.ts');
 assert.equal(/console\.|setTimeout\(|for\s*\(|while\s*\(/.test(s),false);
 assert.equal(/AbortSignal\.timeout/.test(s),true);
});
test('TEST journal has no entitlement write or direct queue publication',()=>{
 const s=read('packages/db/src/stripe-test-inbox.ts')+read('packages/db/src/stripe-test-reconciliation.ts');
 assert.equal(/entitlement\.(?:update|upsert|create)|UPDATE\s+entitlements|INSERT\s+INTO\s+entitlements|SendMessageCommand/.test(s),false);
 assert.equal(/unsafeAcrossAllHouseholds|withGlobalTable/.test(s),false);
});

test('local account page must retain the server loopback gate',()=>{
 const s=read('apps/web/src/app/account-security/page.tsx');
 assert.match(s,/assertLocalAccountMount\(process\.env\)/);
 assert.match(s,/available\?<SecurityPanel/);
 assert.doesNotMatch(s,/createAccountSecurityController|createRecoveryController|createAccountProvider/);
});
