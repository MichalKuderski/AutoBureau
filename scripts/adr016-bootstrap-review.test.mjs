import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewBootstrap } from './adr016-bootstrap-review.mjs';

const template = JSON.parse(await readFile(new URL('../infra/cloudformation/staging/adr016-state-bootstrap.json', import.meta.url), 'utf8'));
test('the draft is private, retained and unable to apply infrastructure', () => {
  assert.deepEqual(reviewBootstrap(template), { status: 'PASS', scope: 'local-template-review-only', resources: 8, deploymentRole: 'read-only', liveApplyAuthorized: false });
});
const corruptions = {
  'a foreign account': t => { t.Conditions.StagingAccountAndRegion['Fn::And'][0]['Fn::Equals'][1] = '123456789012'; },
  'a public state bucket': t => { t.Resources.StateBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy = false; },
  'unretained state': t => { t.Resources.StateBucket.DeletionPolicy = 'Delete'; },
  'unencrypted state': t => { t.Resources.StateBucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm = 'none'; },
  'a wildcard repository': t => { t.Resources.DeploymentRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'] = 'repo:*:environment:staging'; },
  'an unrelated branch': t => { t.Resources.DeploymentRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:ref'].push('refs/heads/unrelated'); },
  'repository-name takeover': t => { delete t.Resources.StateRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:repository_id']; },
  'Production environment trust': t => { t.Resources.StateRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'] = 'repo:MichalKuderski/AutoBureau:environment:production'; },
  'persistent credentials': t => { t.Resources.Credentials = { Type: 'AWS::IAM::AccessKey' }; },
  'premature deployment authority': t => { t.Resources.DeploymentRole.Properties.Policies[0].PolicyDocument.Statement[0].Action.push('s3:PutBucketPolicy'); },
  'boundary removal': t => { t.Resources.DeploymentBoundary.Properties.PolicyDocument.Statement[4].Action.push('iam:DeleteRolePermissionsBoundary'); },
  'unbounded role creation': t => { delete t.Resources.DeploymentBoundary.Properties.PolicyDocument.Statement.find(s => s.Sid === 'CreateOnlyBoundedUploadRoles').Condition; },
  'cross-bucket upload access': t => { t.Resources.UploadBoundary.Properties.PolicyDocument.Statement[0].Resource.push('arn:aws:s3:::another-bucket/*'); },
  'state deletion': t => { t.Resources.StateRole.Properties.Policies[0].PolicyDocument.Statement[1].Action.push('s3:DeleteObject'); },
  'expiry of held locks': t => { t.Resources.StateLocks.Properties.TimeToLiveSpecification = { Enabled: true, AttributeName: 'expires' }; },
  'vacuous lock-key condition': t => { delete t.Resources.StateRole.Properties.Policies[0].PolicyDocument.Statement[4].Condition.Null; },
  'application access to state': t => { t.Resources.StateBucketPolicy.Properties.PolicyDocument.Statement[1].Condition.ArnNotEquals['aws:PrincipalArn'] = 'arn:aws:iam::792394000571:role/pellum-stg-upload-signer'; },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`rejects ${name}`, () => {
  const changed = structuredClone(template); corrupt(changed);
  assert.throws(() => reviewBootstrap(changed), /^Error: STOP: staging bootstrap semantic boundary failed$/);
});
