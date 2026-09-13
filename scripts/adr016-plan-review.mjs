/** Gate for the initial saved quarantine plan, including executable negative controls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const bucket='pellum-stg-quarantine-792394000571-us-east-2';
const arn=`arn:aws:s3:::${bucket}`;
const issuer='oidc.vercel.com/data-analyst-mike';
const rolePrefix='arn:aws:iam::792394000571:';
const sourceDigest='0040869477f660d2ae9782c57b0ba4e422f2f112487e2f1f5fbcaed37fea6151';
const s3Types=['aws_s3_bucket','aws_s3_bucket_public_access_block','aws_s3_bucket_ownership_controls',
  'aws_s3_bucket_server_side_encryption_configuration','aws_s3_bucket_lifecycle_configuration','aws_s3_bucket_cors_configuration','aws_s3_bucket_policy'];
const expected=[...s3Types.map(t=>`${t}.quarantine`),'aws_iam_openid_connect_provider.vercel',
  ...['stg','preview'].flatMap(e=>[`aws_iam_role.upload_signer["${e}"]`,`aws_iam_role_policy.quarantine_only["${e}"]`])];
export function reviewStoragePlan(plan,source) {
  try {
    // Lifecycle prevent_destroy is absent from Terraform's public plan JSON. Pin the
    // exact source reviewed alongside the binary, including that protection and guards.
    assert.equal(createHash('sha256').update(source).digest('hex'),sourceDigest);
    assert.equal(plan.terraform_version,'1.16.2');assert.equal(plan.complete,true);
    assert.equal(plan.applyable,true);assert.equal(plan.errored,false);
    assert.ok(plan.checks.length>0 && plan.checks.every(c=>c.status==='pass'));
    assert.ok([true,'true'].includes(plan.variables.federation_verified.value));
    assert.equal(plan.variables.issuer_mode.value,'team');
    const provider=plan.configuration.provider_config;
    assert.deepEqual(Object.keys(provider),['aws']);
    assert.equal(provider.aws.expressions.region.constant_value,'us-east-2');
    assert.deepEqual(provider.aws.expressions.allowed_account_ids.constant_value,['792394000571']);
    const changes=plan.resource_changes.filter(c=>c.mode==='managed');
    assert.deepEqual(changes.map(c=>c.address).sort(),[...expected].sort());
    for(const c of changes){assert.deepEqual(c.change.actions,['create']);assert.equal(c.change.before,null);}
    assert.ok(plan.resource_changes.every(c=>c.mode==='managed' || (c.mode==='data' && c.address==='data.aws_caller_identity.deployment')));
    const value=address=>changes.find(c=>c.address===address).change.after;
    for(const type of s3Types)assert.equal(value(`${type}.quarantine`).region,'us-east-2');
    const b=value('aws_s3_bucket.quarantine');assert.equal(b.bucket,bucket);assert.equal(b.force_destroy,false);
    const block=value('aws_s3_bucket_public_access_block.quarantine');
    for(const field of ['block_public_acls','block_public_policy','ignore_public_acls','restrict_public_buckets'])assert.equal(block[field],true);
    assert.deepEqual(value('aws_s3_bucket_ownership_controls.quarantine').rule,[{object_ownership:'BucketOwnerEnforced'}]);
    assert.equal(value('aws_s3_bucket_server_side_encryption_configuration.quarantine').rule[0].apply_server_side_encryption_by_default[0].sse_algorithm,'AES256');
    const rules=value('aws_s3_bucket_lifecycle_configuration.quarantine').rule;
    assert.equal(rules.length,1);assert.equal(rules[0].status,'Enabled');assert.equal(rules[0].filter[0].prefix,'hh/');
    assert.equal(rules[0].expiration[0].days,7);assert.equal(rules[0].abort_incomplete_multipart_upload[0].days_after_initiation,1);
    const cors=value('aws_s3_bucket_cors_configuration.quarantine').cors_rule;
    assert.equal(cors.length,1);assert.deepEqual(cors[0].allowed_methods,['PUT']);
    assert.deepEqual([...cors[0].allowed_headers].sort(),['content-length','content-type']);
    assert.deepEqual([...cors[0].allowed_origins].sort(),['https://autobureau-staging-*-data-analyst-mike.vercel.app','https://autobureau-staging.vercel.app']);
    const policy=JSON.parse(value('aws_s3_bucket_policy.quarantine').policy);
    assert.deepEqual(policy,{Version:'2012-10-17',Statement:[
      {Sid:'RequireTLS',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[arn,`${arn}/*`],Condition:{Bool:{'aws:SecureTransport':'false'}}},
      {Sid:'ExpireQuerySignaturesAfterFifteenMinutes',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:`${arn}/*`,Condition:{StringEquals:{'s3:authType':'REST-QUERY-STRING'},NumericGreaterThan:{'s3:signatureAge':'900000'}}},
      {Sid:'NoQuarantineDownloadCapabilities',Effect:'Deny',Principal:'*',Action:'s3:GetObject',Resource:`${arn}/*`,Condition:{StringEquals:{'s3:authType':'REST-QUERY-STRING'}}},
      {Sid:'NoBrowserWriteToSealedCopies',Effect:'Deny',Principal:'*',Action:'s3:PutObject',Resource:`${arn}/hh/*/upload/*/sealed/*`,Condition:{StringEquals:{'s3:authType':'REST-QUERY-STRING'}}},
    ]});
    const oidc=value('aws_iam_openid_connect_provider.vercel');
    assert.equal(oidc.url,`https://${issuer}`);assert.deepEqual(oidc.client_id_list,['https://vercel.com/data-analyst-mike']);
    for(const [env,scope] of [['stg','production'],['preview','preview']]){
      const role=value(`aws_iam_role.upload_signer["${env}"]`);
      assert.equal(role.name,`pellum-${env}-upload-signer`);assert.equal(role.max_session_duration,3600);
      assert.equal(role.permissions_boundary,`${rolePrefix}policy/pellum-stg-upload-boundary`);
      assert.deepEqual(JSON.parse(role.assume_role_policy),{Version:'2012-10-17',Statement:[{
        Effect:'Allow',Principal:{Federated:`${rolePrefix}oidc-provider/${issuer}`},Action:'sts:AssumeRoleWithWebIdentity',
        Condition:{StringEquals:{[`${issuer}:aud`]:'https://vercel.com/data-analyst-mike',[`${issuer}:sub`]:`owner:data-analyst-mike:project:autobureau-staging:environment:${scope}`}},
      }]});
      const permission=value(`aws_iam_role_policy.quarantine_only["${env}"]`);
      assert.equal(permission.name,'quarantine-objects-only');
      assert.deepEqual(JSON.parse(permission.policy),{Version:'2012-10-17',Statement:[
        {Sid:'CreateUploadAndPrivateCopy',Effect:'Allow',Action:['s3:PutObject','s3:GetObject'],Resource:[`${arn}/hh/*/upload/*/incoming`,`${arn}/hh/*/upload/*/sealed/*`]},
        {Sid:'DiscardUnselectedCopy',Effect:'Allow',Action:'s3:DeleteObject',Resource:`${arn}/hh/*/upload/*/sealed/*`},
      ]});
    }
    return {status:'PASS',additions:12,replacements:0,deletions:0,account:'792394000571',region:'us-east-2',sourceDigest};
  }catch{throw new Error('STOP: saved staging storage plan failed semantic review');}
}
export function negativeControls(plan,source){
  const get=(p,a)=>p.resource_changes.find(c=>c.address===a).change;
  const cases=[
    p=>{p.resource_changes[0].change.actions=['delete','create'];},
    p=>{p.resource_changes[0].change.actions=['update'];},
    p=>{p.resource_changes.push({...p.resource_changes[0],address:'aws_sqs_queue.unrelated'});},
    p=>{p.configuration.provider_config.aws.expressions.allowed_account_ids.constant_value=['000000000000'];},
    p=>{get(p,'aws_s3_bucket.quarantine').after.bucket='unrelated-bucket';},
    p=>{get(p,'aws_s3_bucket.quarantine').after.force_destroy=true;},
    p=>{get(p,'aws_s3_bucket_public_access_block.quarantine').after.block_public_policy=false;},
    p=>{get(p,'aws_s3_bucket_policy.quarantine').after.policy='{}';},
    p=>{get(p,'aws_iam_role.upload_signer["stg"]').after.assume_role_policy='{}';},
    p=>{get(p,'aws_iam_role_policy.quarantine_only["preview"]').after.policy='{}';},
    p=>{get(p,'aws_s3_bucket_lifecycle_configuration.quarantine').after.rule[0].expiration[0].days=90;},
    p=>{p.variables.federation_verified.value=false;},
  ];
  for(const mutate of cases){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>reviewStoragePlan(bad,source));}
  assert.throws(()=>reviewStoragePlan(plan,source.replace('prevent_destroy = true','prevent_destroy = false')));
  return cases.length+1;
}
export function reviewDeploymentGrant(template,bootstrap){
  try{
    assert.deepEqual(Object.keys(template.Resources),['ReviewedStorageGrant']);
    assert.deepEqual(template.Conditions,bootstrap.Conditions);
    const r=template.Resources.ReviewedStorageGrant;
    assert.equal(r.Type,'AWS::IAM::Policy');assert.equal(r.Condition,'StagingAccountAndRegion');
    assert.deepEqual(r.Properties.Roles,['pellum-stg-terraform-deploy']);
    assert.equal(r.Properties.PolicyName,'apply-reviewed-adr016-storage-plan');
    const ceiling=bootstrap.Resources.DeploymentBoundary.Properties.PolicyDocument.Statement;
    const many=x=>Array.isArray(x)?x:[x];
    const statements=r.Properties.PolicyDocument.Statement;
    assert.ok(statements.length>0);assert.equal(new Set(statements.map(s=>s.Sid)).size,statements.length);
    for(const s of statements){
      const bound=ceiling.find(c=>c.Sid===s.Sid);assert.ok(bound);
      assert.equal(s.Effect,'Allow');assert.deepEqual(s.Resource,bound.Resource);
      assert.ok(many(s.Action).length>0 && many(s.Action).every(a=>many(bound.Action).includes(a)));
      assert.deepEqual(s.Condition,{...(bound.Condition??{}),DateLessThan:{'aws:CurrentTime':'2026-09-13T22:00:00Z'}});
      assert.equal(s.Principal,undefined);assert.equal(s.NotAction,undefined);assert.equal(s.NotResource,undefined);
    }
    assert.equal(template.Metadata.ReviewedPlan.sha256,'7c553fe2df069921c9cd201f947e0df8a6b54356e4aae02c4edbacbcc1db46c7');
    return {status:'PASS',resources:1,expires:'2026-09-13T22:00:00Z'};
  }catch{throw new Error('STOP: deployment grant exceeds the reviewed boundary');}
}
export function grantNegativeControls(template,bootstrap){
  const cases=[
    t=>{t.Resources.ReviewedStorageGrant.Properties.Roles=['autobureau-production'];},
    t=>{t.Resources.ReviewedStorageGrant.Properties.PolicyDocument.Statement[0].Resource='*';},
    t=>{t.Resources.ReviewedStorageGrant.Properties.PolicyDocument.Statement[0].Action=['iam:PassRole'];},
    t=>{delete t.Resources.ReviewedStorageGrant.Properties.PolicyDocument.Statement[0].Condition.DateLessThan;},
    t=>{t.Resources.ReviewedStorageGrant.Properties.PolicyDocument.Statement[0].NotAction='iam:DeleteRole';},
    t=>{t.Resources.Unrelated={Type:'AWS::IAM::User'};},
  ];
  for(const mutate of cases){const bad=structuredClone(template);mutate(bad);assert.throws(()=>reviewDeploymentGrant(bad,bootstrap));}
  return cases.length;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const plan=JSON.parse(await readFile(process.argv[2],'utf8'));
  const source=await readFile(new URL('../infra/terraform/envs/staging/storage/main.tf',import.meta.url),'utf8');
  const result={...reviewStoragePlan(plan,source),negativeControls:negativeControls(plan,source)};
  if(process.argv[3]){
    const grant=JSON.parse(await readFile(process.argv[3],'utf8'));
    const bootstrap=JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-state-bootstrap.json',import.meta.url),'utf8'));
    result.grant={...reviewDeploymentGrant(grant,bootstrap),negativeControls:grantNegativeControls(grant,bootstrap)};
  }
  console.log(JSON.stringify(result));
}
