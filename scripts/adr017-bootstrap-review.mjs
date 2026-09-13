import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { queueNames, roleNames, metrics } from './adr017-plan-review.mjs';
const list = v => Array.isArray(v) ? v : [v];
const account='792394000571', region='us-east-2';
const bucket='pellum-stg-jobs-tfstate-792394000571-us-east-2', state=`arn:aws:s3:::${bucket}`;
const stateRole='arn:aws:iam::792394000571:role/pellum-stg-jobs-terraform-state';
const locks='arn:aws:dynamodb:us-east-2:792394000571:table/pellum-stg-jobs-tfstate-locks';
const allQueues=queueNames.flatMap(n=>[n,`${n}-dlq`]);
export function reviewJobsBootstrap(t) {
  try {
    const r=t.Resources;
    assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.Type])),{
      StateBucket:'AWS::S3::Bucket',StateBucketPolicy:'AWS::S3::BucketPolicy',StateLocks:'AWS::DynamoDB::Table',
      DeploymentBoundary:'AWS::IAM::ManagedPolicy',StateRole:'AWS::IAM::Role',DeploymentRole:'AWS::IAM::Role',
      StableRuntimeBoundary:'AWS::IAM::ManagedPolicy',PreviewRuntimeBoundary:'AWS::IAM::ManagedPolicy',
    });
    assert.deepEqual(t.Conditions.StagingAccountAndRegion,{'Fn::And':[{'Fn::Equals':[{Ref:'AWS::AccountId'},account]},{'Fn::Equals':[{Ref:'AWS::Region'},region]}]});
    for(const resource of Object.values(r)) {
      assert.equal(resource.Condition,'StagingAccountAndRegion');
      assert(resource.Metadata?.['com.aws.cloudformation.Context']?.why); assert(resource.Metadata?.['com.aws.cloudformation.Context']?.must?.length);
    }
    const b=r.StateBucket.Properties;
    assert.equal(b.BucketName,bucket); assert.deepEqual(b.PublicAccessBlockConfiguration,{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true});
    assert.deepEqual(b.OwnershipControls,{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]});
    assert.deepEqual(b.BucketEncryption,{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]});
    assert.deepEqual(b.VersioningConfiguration,{Status:'Enabled'}); assert(!b.LifecycleConfiguration); assert(!b.AccessControl);
    for(const resource of [r.StateBucket,r.StateLocks]) {assert.equal(resource.DeletionPolicy,'Retain');assert.equal(resource.UpdateReplacePolicy,'Retain');}
    const l=r.StateLocks.Properties; assert.equal(l.TableName,'pellum-stg-jobs-tfstate-locks'); assert.equal(l.SSESpecification.SSEEnabled,true);assert.equal(l.DeletionProtectionEnabled,true);assert(!l.TimeToLiveSpecification);
    assert.deepEqual(r.StateBucketPolicy.Properties.Bucket,{Ref:'StateBucket'});
    assert.equal(l.BillingMode,'PAY_PER_REQUEST');
    assert.equal(r.DeploymentBoundary.Properties.ManagedPolicyName,'pellum-stg-jobs-terraform-deploy-boundary');
    for(const key of ['DeploymentBoundary','StableRuntimeBoundary','PreviewRuntimeBoundary']) for(const forbidden of ['Roles','Users','Groups'])assert(!r[key].Properties[forbidden]);
    const sp=r.StateBucketPolicy.Properties.PolicyDocument.Statement;
    assert.equal(sp.length,3); assert.deepEqual(sp[0],{Sid:'RequireTLS',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[state,`${state}/*`],Condition:{Bool:{'aws:SecureTransport':'false'}}});
    assert.deepEqual(sp[1],{Sid:'OnlyStateRoleMayAccessStateObjects',Effect:'Deny',Principal:'*',Action:['s3:GetObject','s3:GetObjectVersion','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],Resource:`${state}/*`,Condition:{ArnNotEquals:{'aws:PrincipalArn':stateRole}}});
    assert.deepEqual(sp[2],{Sid:'NeverDeleteStateVersions',Effect:'Deny',Principal:'*',Action:['s3:DeleteObject','s3:DeleteObjectVersion'],Resource:`${state}/adr017/jobs.tfstate`});
    for(const [key,name] of [['StateRole','pellum-stg-jobs-terraform-state'],['DeploymentRole','pellum-stg-jobs-terraform-deploy']]) {
      const p=r[key].Properties; assert.equal(p.RoleName,name);assert.equal(p.MaxSessionDuration,3600);assert(!p.ManagedPolicyArns);
      assert.deepEqual(p.AssumeRolePolicyDocument,{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:'arn:aws:iam::792394000571:oidc-provider/token.actions.githubusercontent.com'},Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:{
        'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':'repo:MichalKuderski@177895094/AutoBureau@1336298759:environment:staging',
        'token.actions.githubusercontent.com:repository_id':'1336298759','token.actions.githubusercontent.com:repository_owner_id':'177895094','token.actions.githubusercontent.com:environment':'staging','token.actions.githubusercontent.com:ref':['refs/pull/5/merge'],
      }}}]});
    }
    assert.deepEqual(r.DeploymentRole.Properties.PermissionsBoundary,{Ref:'DeploymentBoundary'});
    const stateStatements=r.StateRole.Properties.Policies[0].PolicyDocument.Statement;assert.equal(stateStatements.length,5);
    for(const s of stateStatements) {
      assert.equal(s.Effect,'Allow');assert(list(s.Resource).every(v=>[state,`${state}/adr017/jobs.tfstate`,`${state}/adr017/jobs.tfstate.tflock`,locks].includes(v)));
      assert(list(s.Action).every(a=>['s3:ListBucket','s3:GetObject','s3:PutObject','s3:DeleteObject','dynamodb:DescribeTable','dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem'].includes(a)));
      if(list(s.Action).includes('s3:DeleteObject'))assert.equal(s.Resource,`${state}/adr017/jobs.tfstate.tflock`);
      if(list(s.Action).includes('dynamodb:PutItem'))assert.deepEqual(s.Condition,{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':[`${bucket}/adr017/jobs.tfstate`,`${bucket}/adr017/jobs.tfstate-md5`]},Null:{'dynamodb:LeadingKeys':'false'}});
    }
    const alarms=allQueues.flatMap(n=>['visible','oldest'].map(m=>`${n}-${m}`)).concat(queueNames.flatMap(n=>metrics.map(m=>`${n}-${m}`)));
    const allowedResources=new Set([...allQueues.map(n=>`arn:aws:sqs:${region}:${account}:${n}`),...roleNames.map(n=>`arn:aws:iam::${account}:role/${n}`),...alarms.map(n=>`arn:aws:cloudwatch:${region}:${account}:alarm:${n}`),'arn:aws:cloudwatch::792394000571:dashboard/pellum-staging-jobs','arn:aws:iam::792394000571:oidc-provider/oidc.vercel.com/data-analyst-mike']);
    const readPolicies=r.DeploymentRole.Properties.Policies;assert.equal(readPolicies.length,1);assert.equal(readPolicies[0].PolicyName,'plan-read-only');
    for(const s of readPolicies[0].PolicyDocument.Statement)assert(list(s.Action).every(a=>/:(Get|List|Describe)/.test(a)));
    const cap=r.DeploymentBoundary.Properties.PolicyDocument;assert(Buffer.byteLength(JSON.stringify(cap))<=6144);
    for(const s of [...readPolicies[0].PolicyDocument.Statement,...cap.Statement]) {
      assert.equal(s.Effect,'Allow');assert(list(s.Resource).every(v=>allowedResources.has(v)));
      assert(list(s.Action).every(a=>['sqs:GetQueueAttributes','sqs:GetQueueUrl','sqs:ListQueueTags','sqs:CreateQueue','sqs:SetQueueAttributes','sqs:TagQueue','iam:GetRole','iam:GetRolePolicy','iam:ListRolePolicies','iam:ListAttachedRolePolicies','iam:ListInstanceProfilesForRole','iam:ListRoleTags','iam:GetOpenIDConnectProvider','iam:CreateRole','iam:TagRole','iam:PutRolePolicy','cloudwatch:DescribeAlarms','cloudwatch:ListTagsForResource','cloudwatch:GetDashboard','cloudwatch:PutDashboard','cloudwatch:PutMetricAlarm','cloudwatch:TagResource'].includes(a)));
      assert(list(s.Action).every(a=>!/:.*\*|:(Delete|Remove|Detach|Attach|Pass|Assume|Purge|UpdateAssume|CreateAccessKey|CreatePolicy|PutRolePermissionsBoundary)/.test(a)));
      if(list(s.Action).includes('iam:CreateRole')) {
        const scope=list(s.Resource)[0].includes('-preview-')?'preview':'stg'; assert(list(s.Resource).every(v=>v.includes(`pellum-${scope}-job-`)));
        assert.deepEqual(s.Condition,{StringEquals:{'iam:PermissionsBoundary':`arn:aws:iam::792394000571:policy/pellum-${scope}-job-runtime-boundary`}});
      }
    }
    for(const [key,scope] of [['StableRuntimeBoundary','stg'],['PreviewRuntimeBoundary','preview']]) {
      const p=r[key].Properties;assert.equal(p.ManagedPolicyName,`pellum-${scope}-job-runtime-boundary`);
      assert.deepEqual(p.PolicyDocument,{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['sqs:ChangeMessageVisibility','sqs:DeleteMessage','sqs:ReceiveMessage','sqs:SendMessage'],Resource:['pipeline','notifications'].map(q=>`arn:aws:sqs:${region}:${account}:pellum-${scope}-${q}`)},{Effect:'Allow',Action:['cloudwatch:PutMetricData'],Resource:'*',Condition:{StringEquals:{'cloudwatch:namespace':['pipeline','notifications'].map(q=>`Pellum/StagingJobs/${scope}/${q}`)}}}]});
    }
    return {status:'PASS',bootstrapAdditions:8,separateState:true,exactTrust:true,productionResources:0,credentials:0,continuousWorkers:0};
  } catch { throw new Error('ADR-017 bootstrap rejected; template values withheld'); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(reviewJobsBootstrap(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}catch{console.error('ADR-017 bootstrap rejected; template values withheld');process.exitCode=1;}}
