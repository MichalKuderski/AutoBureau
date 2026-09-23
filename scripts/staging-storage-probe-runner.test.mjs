import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReceipt } from './staging-storage-probe-runner.mjs';
const household='11111111-1111-4111-8111-111111111111',upload='22222222-2222-4222-8222-222222222222';
const fixture={household,upload,incoming:`hh/${household}/upload/${upload}/incoming`,sealed:[3,4].map(n=>`hh/${household}/upload/${upload}/sealed/${n}3333333-3333-4333-8333-333333333333`)};
const good={scope:'preview',bucket:'pellum-stg-quarantine-792394000571-us-east-2',roleArn:'arn:aws:iam::792394000571:role/pellum-preview-upload-signer',intakeEnabled:false,realTenantData:false,productionApplicationAccessed:false,fixture,results:[{name:'native-scope-role-assumption',status:'PASS'}]};
test('projects only the reviewed synthetic evidence shape',()=>{
  const safe=safeReceipt({...good,token:'withheld',url:'https://example.invalid/?signature=withheld',results:[{...good.results[0],url:'secret'}]});
  assert.equal(safe.scope,'preview');assert.ok(!JSON.stringify(safe).includes('withheld'));assert.ok(!JSON.stringify(safe).includes('secret'));
});
test('rejects foreign scope, bucket, role, fixture and non-opaque result data',()=>{
  for(const changed of [{scope:'production'},{bucket:'unrelated'},{roleArn:'unrelated'},{intakeEnabled:true},{realTenantData:true},
    {fixture:{...fixture,incoming:'unrelated'}},{results:[{name:'https://secret',status:'PASS'}]},{results:[{name:'safe',status:'token'}]}]) assert.throws(()=>safeReceipt({...good,...changed}));
});

const {verifyProofDeployment}=await import('./staging-storage-provider-proof.mjs');
const before={stable:{deploymentId:'dpl_stable'}};
const deployment={id:'dpl_disposable',projectId:'prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR',name:'autobureau-staging',url:'autobureau-staging-example-data-analyst-mike.vercel.app',target:'production'};
test('proof deployment guard prevents separate Production access or stable deletion',()=>{
  verifyProofDeployment(deployment,before,'production');verifyProofDeployment({...deployment,target:null},before,'preview');
  for(const changed of [{projectId:'production-app'},{name:'autobureau-production'},{id:'dpl_stable'},{url:'autobureau-staging.vercel.app'},{target:'preview'}]) assert.throws(()=>verifyProofDeployment({...deployment,...changed},before,'production'));
  assert.throws(()=>verifyProofDeployment(deployment,before,'preview'));
});
