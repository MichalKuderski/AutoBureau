import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {reviewJobsBootstrap} from './adr017-bootstrap-review.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../infra/cloudformation/staging/adr017-state-bootstrap.json',import.meta.url)));
test('reviewed separate staging bootstrap passes',()=>assert.equal(reviewJobsBootstrap(source).status,'PASS'));
const changes={
  public_bucket:r=>r.StateBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy=false,
  plaintext_state:r=>delete r.StateBucket.Properties.BucketEncryption,
  wrong_region:(_r,t)=>t.Conditions.StagingAccountAndRegion['Fn::And'][1]['Fn::Equals'][1]='us-west-2',
  persistent_key:r=>r.AccessKey={Type:'AWS::IAM::AccessKey'},
  root_trust:r=>r.StateRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal={AWS:'arn:aws:iam::792394000571:root'},
  wildcard_ref:r=>r.StateRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:ref']=['refs/pull/*/merge'],
  foreign_subject:r=>r.DeploymentRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub']='repo:other:environment:staging',
  cross_state:r=>r.StateRole.Properties.Policies[0].PolicyDocument.Statement[1].Resource='arn:aws:s3:::pellum-stg-tfstate-792394000571-us-east-2/adr016/storage.tfstate',
  delete_state:r=>r.StateRole.Properties.Policies[0].PolicyDocument.Statement[1].Action.push('s3:DeleteObject'),
  delete_locks:r=>r.StateLocks.Properties.DeletionProtectionEnabled=false,
  wildcard_deploy:r=>r.DeploymentBoundary.Properties.PolicyDocument.Statement[0].Resource='*',
  queue_purge:r=>r.DeploymentBoundary.Properties.PolicyDocument.Statement[0].Action.push('sqs:PurgeQueue'),
  cross_env_runtime:r=>r.StableRuntimeBoundary.Properties.PolicyDocument.Statement[0].Resource.push('arn:aws:sqs:us-east-2:792394000571:pellum-preview-pipeline'),
  permission_backdoor:r=>r.DeploymentBoundary.Properties.PolicyDocument.Statement[0].Action.push('sqs:AddPermission'),
  existing_role_attachment:r=>r.DeploymentBoundary.Properties.Roles=['unrelated-role'],
  wrong_policy_bucket:r=>r.StateBucketPolicy.Properties.Bucket='unrelated-bucket',
  arbitrary_metrics:r=>delete r.StableRuntimeBoundary.Properties.PolicyDocument.Statement[1].Condition,
};
for(const [name,change]of Object.entries(changes))test(`rejects ${name}`,()=>{const t=structuredClone(source);change(t.Resources,t);assert.throws(()=>reviewJobsBootstrap(t),/rejected/);});
