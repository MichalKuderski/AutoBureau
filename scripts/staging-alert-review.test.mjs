import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewAlertTemplate } from './staging-alert-review.mjs';
const t=JSON.parse(fs.readFileSync(new URL('../infra/cloudformation/staging/operational-alerts.json',import.meta.url)));
test('only exact encrypted operational alert resources are admitted',()=>assert.equal(reviewAlertTemplate(t).resources,6));
const changes={
 extra_compute:v=>v.Resources.Worker={Type:'AWS::EC2::Instance'},
 missing_encryption:v=>delete v.Resources.AlertTopic.Properties.KmsMasterKeyId,
 wrong_region:v=>v.Resources.AlertKey.Properties.MultiRegion=true,
 wildcard_trust:v=>v.Resources.AlertKey.Properties.KeyPolicy.Statement[1].Principal='*',
 wildcard_alarm:v=>v.Resources.AlertKey.Properties.KeyPolicy.Statement[1].Condition.ArnEquals['aws:SourceArn']=['*'],
 foreign_account:v=>v.Resources.AlertTopicPolicy.Properties.PolicyDocument.Statement[1].Condition.StringEquals['aws:SourceAccount']='111111111111',
 extra_grant:v=>v.Resources.AlertTopicPolicy.Properties.PolicyDocument.Statement.push({Effect:'Allow',Principal:'*',Action:'sns:*',Resource:'*'}),
 unsupported_sns_wildcard:v=>v.Resources.AlertTopicPolicy.Properties.PolicyDocument.Statement[0].Action='sns:*',
 missing_tls:v=>v.Resources.AlertTopicPolicy.Properties.PolicyDocument.Statement.shift(),
 public_recipient:v=>v.Parameters.AlertEmail.NoEcho=false,
 other_subscription:v=>v.Resources.AlertSubscription.Properties.Protocol='https',
 production_destination:v=>v.Resources.DeliveryProbe.Properties.AlarmActions=['arn:aws:sns:us-east-2:792394000571:production'],
 worker_metric:v=>v.Resources.DeliveryProbe.Properties.Namespace='AWS/EC2',
 disabled_alarm:v=>v.Resources.DeliveryProbe.Properties.ActionsEnabled=false,
 disposable_key:v=>v.Resources.AlertKey.DeletionPolicy='Delete',
};
for(const [name,edit] of Object.entries(changes))test(`refuses ${name}`,()=>{const v=structuredClone(t);edit(v);assert.throws(()=>reviewAlertTemplate(v));});
