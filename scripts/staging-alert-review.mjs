import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { queueNames, metrics } from './adr017-plan-review.mjs';
export const topic = 'arn:aws:sns:us-east-2:792394000571:pellum-stg-operational-alerts';
export const alarmNames = [...queueNames.flatMap(q => ['', '-dlq'].flatMap(s => ['visible','oldest'].map(m => `${q}${s}-${m}`))), ...queueNames.flatMap(q => metrics.map(m => `${q}-${m}`)), 'pellum-stg-alert-delivery-probe'];
export function reviewAlertTemplate(t) {
  const r=t.Resources;
  assert.deepEqual(Object.keys(r).sort(),['AlertKey','AlertKeyAlias','AlertTopic','AlertTopicPolicy','AlertSubscription','DeliveryProbe'].sort());
  assert.equal(t.Parameters.AlertEmail.NoEcho,true);
  assert.equal(t.Parameters.AlertEmail.Default,undefined);
  const condition={StringEquals:{'aws:SourceAccount':'792394000571'},ArnEquals:{'aws:SourceArn':alarmNames.map(n=>`arn:aws:cloudwatch:us-east-2:792394000571:alarm:${n}`)}};
  const key=r.AlertKey.Properties;
  assert.equal(r.AlertKey.Type,'AWS::KMS::Key'); assert.equal(r.AlertKey.DeletionPolicy,'Retain'); assert.equal(r.AlertKey.UpdateReplacePolicy,'Retain');
  assert.equal(key.EnableKeyRotation,true); assert.equal(key.MultiRegion,false); assert.equal(key.KeyUsage,'ENCRYPT_DECRYPT'); assert.equal(key.KeySpec,'SYMMETRIC_DEFAULT'); assert.equal(key.PendingWindowInDays,30);
  // Resource:* in an embedded KMS key policy means only this key, not all account keys.
  assert.deepEqual(key.KeyPolicy,{Version:'2012-10-17',Statement:[{Sid:'ExactAccountKeyAdministration',Effect:'Allow',Principal:{AWS:'arn:aws:iam::792394000571:root'},Action:'kms:*',Resource:'*'}, {Sid:'OnlyReviewedCloudWatchAlarms',Effect:'Allow',Principal:{Service:'cloudwatch.amazonaws.com'},Action:['kms:GenerateDataKey*','kms:Decrypt'],Resource:'*',Condition:condition}]});
  assert.equal(r.AlertKeyAlias.Type,'AWS::KMS::Alias'); assert.deepEqual(r.AlertKeyAlias.Properties,{AliasName:'alias/pellum-stg-operational-alerts',TargetKeyId:{Ref:'AlertKey'}});
  assert.equal(r.AlertTopic.Type,'AWS::SNS::Topic'); assert.equal(r.AlertTopic.DeletionPolicy,'Retain'); assert.equal(r.AlertTopic.UpdateReplacePolicy,'Retain');
  assert.equal(r.AlertTopic.Properties.TopicName,'pellum-stg-operational-alerts'); assert.deepEqual(r.AlertTopic.Properties.KmsMasterKeyId,{'Fn::GetAtt':['AlertKey','Arn']});
  assert.equal(r.AlertTopicPolicy.Type,'AWS::SNS::TopicPolicy'); assert.deepEqual(r.AlertTopicPolicy.Properties.Topics,[{Ref:'AlertTopic'}]);
  assert.deepEqual(r.AlertTopicPolicy.Properties.PolicyDocument,{Version:'2012-10-17',Statement:[{Sid:'TLSRequired',Effect:'Deny',Principal:'*',Action:["sns:AddPermission","sns:DeleteTopic","sns:GetDataProtectionPolicy","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","sns:ListTagsForResource","sns:Publish","sns:PutDataProtectionPolicy","sns:RemovePermission","sns:SetTopicAttributes","sns:Subscribe"],Resource:topic,Condition:{Bool:{'aws:SecureTransport':'false'}}},{Sid:'OnlyReviewedCloudWatchAlarms',Effect:'Allow',Principal:{Service:'cloudwatch.amazonaws.com'},Action:'sns:Publish',Resource:topic,Condition:condition}]});
  assert.equal(r.AlertSubscription.Type,'AWS::SNS::Subscription'); assert.deepEqual(r.AlertSubscription.Properties,{TopicArn:{Ref:'AlertTopic'},Protocol:'email',Endpoint:{Ref:'AlertEmail'}});
  const p=r.DeliveryProbe.Properties; assert.equal(r.DeliveryProbe.Type,'AWS::CloudWatch::Alarm');
  assert.equal(p.AlarmName,'pellum-stg-alert-delivery-probe'); assert.equal(p.Namespace,'Pellum/StagingAlertProbe'); assert.equal(p.MetricName,'Connectivity');
  assert.equal(p.Statistic,'Maximum'); assert.equal(p.Period,60); assert.equal(p.EvaluationPeriods,1); assert.equal(p.Threshold,0); assert.equal(p.ComparisonOperator,'GreaterThanThreshold'); assert.equal(p.TreatMissingData,'notBreaching'); assert.equal(p.ActionsEnabled,true);
  assert.deepEqual(p.AlarmActions,[{Ref:'AlertTopic'}]); assert.deepEqual(p.OKActions,[]); assert.deepEqual(p.InsufficientDataActions,[]);
  return {resources:6,sourceAlarms:41,queueChanges:0,workerChanges:0,productionResources:0,persistentCredentials:0,notificationDeliveryProven:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){try{process.stdout.write(JSON.stringify(reviewAlertTemplate(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))))+'\n');}catch{console.error('Staging alert template rejected');process.exitCode=1;}}
