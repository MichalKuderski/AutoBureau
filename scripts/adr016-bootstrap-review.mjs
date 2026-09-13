/** Local semantic gate only. This does not prove live IAM or authorize an apply. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const account = '792394000571';
const state = 'arn:aws:s3:::pellum-stg-tfstate-792394000571-us-east-2';
const quarantine = 'arn:aws:s3:::pellum-stg-quarantine-792394000571-us-east-2';
const role = name => `arn:aws:iam::${account}:role/${name}`;
const asList = value => Array.isArray(value) ? value : [value];
const canonical = value => JSON.stringify(value);

export function reviewBootstrap(template) {
  // Never include provider values or a possibly modified policy in error messages.
  try {
    const r = template.Resources;
    assert.deepEqual(Object.keys(r).sort(), ['StateBucket', 'StateBucketPolicy', 'StateLocks', 'GitHubProvider', 'UploadBoundary', 'DeploymentBoundary', 'StateRole', 'DeploymentRole'].sort());
    assert.deepEqual(Object.fromEntries(Object.entries(r).map(([key, item]) => [key, item.Type])), {
      StateBucket: 'AWS::S3::Bucket', StateBucketPolicy: 'AWS::S3::BucketPolicy', StateLocks: 'AWS::DynamoDB::Table',
      GitHubProvider: 'AWS::IAM::OIDCProvider', UploadBoundary: 'AWS::IAM::ManagedPolicy', DeploymentBoundary: 'AWS::IAM::ManagedPolicy',
      StateRole: 'AWS::IAM::Role', DeploymentRole: 'AWS::IAM::Role',
    });
    assert.deepEqual(template.Conditions.StagingAccountAndRegion, { 'Fn::And': [
      { 'Fn::Equals': [{ Ref: 'AWS::AccountId' }, account] },
      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-east-2'] },
    ] });
    for (const item of Object.values(r)) {
      assert.equal(item.Condition, 'StagingAccountAndRegion');
      assert.ok(item.Metadata['com.aws.cloudformation.Context'].why);
      assert.ok(item.Metadata['com.aws.cloudformation.Context'].must.length);
    }
    assert.equal(r.StateBucket.Properties.BucketName, state.slice('arn:aws:s3:::'.length));
    assert.deepEqual(r.StateBucket.Properties.PublicAccessBlockConfiguration, { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
    assert.deepEqual(r.StateBucket.Properties.OwnershipControls, { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
    assert.equal(r.StateBucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
    assert.equal(r.StateBucket.Properties.VersioningConfiguration.Status, 'Enabled');
    for (const item of [r.StateBucket, r.StateLocks]) {
      assert.equal(item.DeletionPolicy, 'Retain'); assert.equal(item.UpdateReplacePolicy, 'Retain');
    }
    assert.equal(r.StateLocks.Properties.DeletionProtectionEnabled, true);
    assert.equal(r.StateLocks.Properties.SSESpecification.SSEEnabled, true);
    assert.equal(r.StateLocks.Properties.BillingMode, 'PAY_PER_REQUEST');
    assert.equal(r.StateLocks.Properties.TimeToLiveSpecification, undefined);
    assert.equal(r.GitHubProvider.Properties.Url, 'https://token.actions.githubusercontent.com');
    assert.deepEqual(r.GitHubProvider.Properties.ClientIdList, ['sts.amazonaws.com']);
    for (const [name, expectedName] of [['StateRole', 'pellum-stg-terraform-state'], ['DeploymentRole', 'pellum-stg-terraform-deploy']]) {
      const properties = r[name].Properties;
      assert.equal(properties.RoleName, expectedName);
      assert.equal(properties.MaxSessionDuration, 3600);
      assert.deepEqual(properties.AssumeRolePolicyDocument, { Version: '2012-10-17', Statement: [{
        Effect: 'Allow', Principal: { Federated: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com` },
        Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': 'repo:MichalKuderski/AutoBureau:environment:staging',
          'token.actions.githubusercontent.com:repository_id': '1336298759',
          'token.actions.githubusercontent.com:repository_owner_id': '177895094',
          'token.actions.githubusercontent.com:environment': 'staging',
          'token.actions.githubusercontent.com:ref': ['refs/heads/main', 'refs/pull/5/merge'],
        } },
      }] });
      assert.equal(properties.ManagedPolicyArns, undefined);
    }
    assert.deepEqual(r.DeploymentRole.Properties.PermissionsBoundary, { Ref: 'DeploymentBoundary' });
    const readPolicies = r.DeploymentRole.Properties.Policies;
    assert.equal(readPolicies.length, 1); assert.equal(readPolicies[0].PolicyName, 'plan-read-only');
    for (const statement of readPolicies[0].PolicyDocument.Statement) {
      assert.equal(statement.Effect, 'Allow');
      assert.ok(asList(statement.Action).every(action => /^(s3|iam):(Get|List)[A-Za-z]+$/.test(action)));
    }
    const allowedDeploymentResources = new Set([quarantine, role('pellum-stg-upload-signer'), role('pellum-preview-upload-signer'), `arn:aws:iam::${account}:oidc-provider/oidc.vercel.com/data-analyst-mike`]);
    for (const statement of [...readPolicies[0].PolicyDocument.Statement, ...r.DeploymentBoundary.Properties.PolicyDocument.Statement]) {
      assert.equal(statement.Effect, 'Allow');
      assert.ok(asList(statement.Resource).every(resource => allowedDeploymentResources.has(resource)));
      assert.ok(asList(statement.Action).every(action => !/\*|:(Delete|Remove|Detach|Attach|PassRole|CreatePolicy|PutRolePermissionsBoundary)/.test(action)));
      if (asList(statement.Action).includes('iam:CreateRole')) {
        assert.deepEqual(statement.Condition, { StringEquals: { 'iam:PermissionsBoundary': `arn:aws:iam::${account}:policy/pellum-stg-upload-boundary` } });
      }
      if (asList(statement.Action).includes('s3:CreateBucket')) assert.deepEqual(statement.Condition, { StringEquals: { 's3:LocationConstraint': 'us-east-2' } });
    }
    assert.deepEqual(r.UploadBoundary.Properties.PolicyDocument.Statement.map(({ Effect, Action, Resource }) => ({ Effect, Action, Resource })), [
      { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: [`${quarantine}/hh/*/upload/*/incoming`, `${quarantine}/hh/*/upload/*/sealed/*`] },
      { Effect: 'Allow', Action: 's3:DeleteObject', Resource: `${quarantine}/hh/*/upload/*/sealed/*` },
    ]);
    const stateStatements = r.StateRole.Properties.Policies[0].PolicyDocument.Statement;
    assert.equal(r.StateRole.Properties.Policies.length, 1);
    assert.equal(stateStatements.length, 5);
    for (const statement of stateStatements) {
      assert.equal(statement.Effect, 'Allow');
      assert.ok(asList(statement.Action).every(action => ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject', 'dynamodb:DescribeTable', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'].includes(action)));
      assert.ok(asList(statement.Resource).every(resource => [state, `${state}/adr016/storage.tfstate`, `${state}/adr016/storage.tfstate.tflock`, `arn:aws:dynamodb:us-east-2:${account}:table/pellum-stg-tfstate-locks`].includes(resource)));
      if (asList(statement.Action).includes('s3:DeleteObject')) assert.equal(statement.Resource, `${state}/adr016/storage.tfstate.tflock`);
      if (asList(statement.Action).includes('dynamodb:PutItem')) {
        assert.equal(statement.Condition.Null['dynamodb:LeadingKeys'], 'false');
        assert.deepEqual(statement.Condition['ForAllValues:StringEquals']['dynamodb:LeadingKeys'], ['pellum-stg-tfstate-792394000571-us-east-2/adr016/storage.tfstate', 'pellum-stg-tfstate-792394000571-us-east-2/adr016/storage.tfstate-md5']);
      }
    }
    const bucketPolicy = r.StateBucketPolicy.Properties.PolicyDocument.Statement;
    assert.equal(bucketPolicy.length, 3); assert.ok(bucketPolicy.every(statement => statement.Effect === 'Deny' && statement.Principal === '*'));
    assert.deepEqual(bucketPolicy[0].Condition, { Bool: { 'aws:SecureTransport': 'false' } });
    assert.deepEqual(bucketPolicy[0].Resource, [state, `${state}/*`]); assert.equal(bucketPolicy[0].Action, 's3:*');
    assert.deepEqual(bucketPolicy[1].Condition, { ArnNotEquals: { 'aws:PrincipalArn': role('pellum-stg-terraform-state') } });
    assert.equal(bucketPolicy[1].Resource, `${state}/*`);
    assert.deepEqual(bucketPolicy[1].Action, ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion']);
    assert.equal(bucketPolicy[2].Resource, `${state}/adr016/storage.tfstate`);
    assert.deepEqual(bucketPolicy[2].Action, ['s3:DeleteObject', 's3:DeleteObjectVersion']); assert.equal(bucketPolicy[2].Condition, undefined);
    assert.ok(!canonical(r).includes('autobureau-production'));
    return { status: 'PASS', scope: 'local-template-review-only', resources: 8, deploymentRole: 'read-only', liveApplyAuthorized: false };
  } catch { throw new Error('STOP: staging bootstrap semantic boundary failed'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(reviewBootstrap(JSON.parse(await readFile(process.argv[2], 'utf8'))))); }
  catch { console.error('STOP: staging bootstrap semantic boundary failed'); process.exitCode = 1; }
}
