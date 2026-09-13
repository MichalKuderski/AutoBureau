import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reviewJobsPlan } from './adr017-plan-review.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/adr017-mock-plan.json',import.meta.url)));
const find = (p,type,name) => p.resource_changes.find(c => c.type === type && (!name || c.name === name)).change.after;
function editPolicy(a,key,fn) { const p=JSON.parse(a[key]); fn(p); a[key]=JSON.stringify(p); }
test('reviewed mock has only the intended 69 additions; not live apply evidence',()=>assert.equal(reviewJobsPlan(structuredClone(fixture)).additions,69));
const bad = {
  gate_closed: p=>p.variables.preapply_verified.value=false,
  replacement: p=>p.resource_changes[0].change.actions=['delete','create'],
  extra_resource: p=>p.resource_changes.push(structuredClone(p.resource_changes[0])),
  plaintext_queue: p=>find(p,'aws_sqs_queue').sqs_managed_sse_enabled=false,
  fifo_queue: p=>find(p,'aws_sqs_queue').fifo_queue=true,
  arbitrary_visibility: p=>find(p,'aws_sqs_queue').visibility_timeout_seconds=30,
  retention_drift: p=>find(p,'aws_sqs_queue').message_retention_seconds=60,
  foreign_redrive: p=>find(p,'aws_sqs_queue','dlq').redrive_allow_policy=JSON.stringify({redrivePermission:'allowAll'}),
  retry_drift: p=>editPolicy(find(p,'aws_sqs_queue','main'),'redrive_policy',v=>v.maxReceiveCount=100),
  plaintext_access: p=>editPolicy(find(p,'aws_sqs_queue_policy'),'policy',v=>v.Statement.shift()),
  public_access: p=>editPolicy(find(p,'aws_sqs_queue_policy'),'policy',v=>v.Statement.push({Effect:'Allow',Principal:'*',Action:'sqs:*',Resource:'*'})),
  wildcard_trust: p=>editPolicy(find(p,'aws_iam_role'),'assume_role_policy',v=>v.Statement[0].Principal={AWS:'*'}),
  no_boundary: p=>find(p,'aws_iam_role').permissions_boundary=null,
  unrelated_runtime: p=>editPolicy(find(p,'aws_iam_role_policy'),'policy',v=>v.Statement[0].Resource=['*']),
  arbitrary_metrics: p=>editPolicy(find(p,'aws_iam_role_policy'),'policy',v=>delete v.Statement[1].Condition),
  alarm_disabled_by_threshold: p=>find(p,'aws_cloudwatch_metric_alarm').threshold=1e9,
  alarm_wrong_queue: p=>find(p,'aws_cloudwatch_metric_alarm','visible').dimensions={QueueName:'production'},
  alarm_tenant_dimension: p=>find(p,'aws_cloudwatch_metric_alarm','application').dimensions={HouseholdId:'opaque-but-unbounded'},
  alarm_wrong_window: p=>find(p,'aws_cloudwatch_metric_alarm').evaluation_periods=100,
  alarm_unapproved_destination: p=>find(p,'aws_cloudwatch_metric_alarm').alarm_actions=['arn:aws:sns:us-east-2:792394000571:unreviewed'],
  alarm_no_destination: p=>find(p,'aws_cloudwatch_metric_alarm').alarm_actions=[],
  dashboard_missing_receive: p=>editPolicy(find(p,'aws_cloudwatch_dashboard'),'dashboard_body',v=>v.widgets[0].properties.metrics[2][1]='Other'),
  dashboard_duplicate: p=>editPolicy(find(p,'aws_cloudwatch_dashboard'),'dashboard_body',v=>v.widgets[0]=v.widgets[1]),
};
for(const [name,change] of Object.entries(bad)) test(`refuses ${name}`,()=>{const p=structuredClone(fixture);change(p);assert.throws(()=>reviewJobsPlan(p));});
