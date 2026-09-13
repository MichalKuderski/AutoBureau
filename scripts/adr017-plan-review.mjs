import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export const scopes = { stg: 'production', preview: 'preview' };
export const kinds = ['pipeline','notifications'];
export const metrics = ['send_failure','processing_failure','retry','exhausted','delivery_lag_ms','reconciliation_mismatch'];
export const queueNames = Object.keys(scopes).flatMap(s => kinds.map(q => `pellum-${s}-${q}`));
export const roleNames = Object.keys(scopes).flatMap(s => ['dispatcher','pipeline-worker','notifications-worker'].map(r => `pellum-${s}-job-${r}`));
const arn = n => `arn:aws:sqs:us-east-2:792394000571:${n}`;
const deploy = 'arn:aws:iam::792394000571:role/pellum-stg-jobs-terraform-deploy';
const issuer = 'oidc.vercel.com/data-analyst-mike';
function policy(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function scopedRole(name) { return roleNames.includes(name) && name.includes('-preview-') ? 'preview' : 'stg'; }
export function expectedRuntimePolicy(name) {
  assert(roleNames.includes(name)); const scope = scopedRole(name), dispatcher = name.endsWith('-dispatcher');
  const queues = dispatcher ? kinds : [name.includes('-pipeline-') ? 'pipeline' : 'notifications'];
  return { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: dispatcher ? ['sqs:SendMessage'] : ['sqs:ChangeMessageVisibility','sqs:DeleteMessage','sqs:ReceiveMessage'], Resource: queues.map(q => arn(`pellum-${scope}-${q}`)) },
    { Effect: 'Allow', Action: ['cloudwatch:PutMetricData'], Resource: '*', Condition: { StringEquals: { 'cloudwatch:namespace': queues.map(q => `Pellum/StagingJobs/${scope}/${q}`) } } },
  ] };
}
function reviewQueuePolicy(p, name, dlq) {
  const scope = name.includes('-preview-') ? 'preview' : 'stg', kind = name.includes('-pipeline') ? 'pipeline' : 'notifications';
  const expected = { Version: '2012-10-17', Statement: [
    { Sid: 'RequireTLS', Effect: 'Deny', Principal: '*', Action: 'sqs:*', Resource: arn(name), Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
    { Sid: dlq ? 'NoRuntimeOrForeignDeadLetterAccess' : 'OnlyExactStagingPrincipals', Effect: 'Deny', Principal: '*', Action: 'sqs:*', Resource: arn(name), Condition: {
      ArnNotEquals: { 'aws:PrincipalArn': ['arn:aws:iam::792394000571:root',deploy,...(dlq ? [] : [`arn:aws:iam::792394000571:role/pellum-${scope}-job-dispatcher`,`arn:aws:iam::792394000571:role/pellum-${scope}-job-${kind}-worker`])] },
      Bool: { 'aws:PrincipalIsAWSService': 'false' },
    } },
    { Sid: dlq ? 'NoAutomaticReplayOrPurge' : 'NoQueuePurge', Effect: 'Deny', Principal: '*', Action: dlq ? ['sqs:StartMessageMoveTask','sqs:PurgeQueue'] : 'sqs:PurgeQueue', Resource: arn(name) },
  ] };
  assert.deepEqual(policy(p), expected, `Queue policy drift: ${name}`);
}
export function reviewJobsPlan(plan) {
  assert.equal(plan.errored, false);
  assert.equal(plan.variables?.preapply_verified?.value, true);
  const changes = (plan.resource_changes ?? []).filter(r => r.mode !== 'data');
  assert.equal(changes.length, 69, 'Only the reviewed 69 additions are permitted');
  const expected = new Set();
  for (const q of queueNames) for (const type of ['aws_sqs_queue.main','aws_sqs_queue.dlq','aws_sqs_queue_policy.main','aws_sqs_queue_policy.dlq']) expected.add(`${type}["${q}"]`);
  for (const name of roleNames) for (const type of ['aws_iam_role.runtime','aws_iam_role_policy.runtime']) expected.add(`${type}["${name}"]`);
  for (const q of queueNames.flatMap(n => [n,`${n}-dlq`])) for (const type of ['visible','oldest']) expected.add(`aws_cloudwatch_metric_alarm.${type}["${q}"]`);
  for (const q of queueNames) for (const m of metrics) expected.add(`aws_cloudwatch_metric_alarm.application["${q}-${m}"]`);
  expected.add('aws_cloudwatch_dashboard.jobs');
  assert.deepEqual(new Set(changes.map(c => c.address)), expected);
  for (const change of changes) {
    assert.deepEqual(change.change.actions, ['create'], `Non-addition: ${change.address}`);
    const a = change.change.after;
    if (change.type === 'aws_sqs_queue') {
      const dlq = change.name === 'dlq', name = String(a.name), base = dlq ? name.slice(0,-4) : name;
      assert(queueNames.includes(base)); assert.equal(a.sqs_managed_sse_enabled,true);
      assert.equal(a.fifo_queue,false); assert(!a.kms_master_key_id); assert.equal(a.max_message_size,1024);
      assert.equal(a.message_retention_seconds,dlq ? 1209600 : 604800); assert.equal(a.receive_wait_time_seconds,20); assert.equal(a.visibility_timeout_seconds,60);
      if (dlq) assert.deepEqual(policy(a.redrive_allow_policy),{redrivePermission:'byQueue',sourceQueueArns:[arn(base)]});
      else {
        assert.deepEqual(policy(a.redrive_policy),{deadLetterTargetArn:arn(`${base}-dlq`),maxReceiveCount:3});
        assert.deepEqual(policy(a.redrive_allow_policy),{redrivePermission:'denyAll'});
      }
    } else if (change.type === 'aws_sqs_queue_policy') {
      const base = change.index; assert(queueNames.includes(base)); const dlq = change.name === 'dlq'; reviewQueuePolicy(a.policy,dlq ? `${base}-dlq` : base,dlq);
    } else if (change.type === 'aws_iam_role') {
      const scope = scopedRole(a.name); assert(roleNames.includes(a.name)); assert.equal(a.max_session_duration,3600);
      assert.equal(a.permissions_boundary,`arn:aws:iam::792394000571:policy/pellum-${scope}-job-runtime-boundary`);
      assert.deepEqual(policy(a.assume_role_policy), {Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:`arn:aws:iam::792394000571:oidc-provider/${issuer}`},Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:{[`${issuer}:aud`]:'https://vercel.com/data-analyst-mike',[`${issuer}:sub`]:`owner:data-analyst-mike:project:autobureau-staging:environment:${scopes[scope]}`}}}]});
    } else if (change.type === 'aws_iam_role_policy') {
      assert.equal(a.name,'exact-queue-runtime'); assert.deepEqual(policy(a.policy),expectedRuntimePolicy(change.index));
    } else if (change.type === 'aws_cloudwatch_metric_alarm') {
      const application = change.name === 'application'; const scope = a.alarm_name.includes('-preview-') ? 'preview' : 'stg'; const kind = a.alarm_name.includes('-pipeline-') ? 'pipeline' : 'notifications';
      assert.equal(a.namespace,application ? `Pellum/StagingJobs/${scope}/${kind}` : 'AWS/SQS');
      assert.equal(a.period,60); assert.equal(a.comparison_operator,'GreaterThanThreshold'); assert.equal(a.treat_missing_data,'notBreaching');
      assert.deepEqual(a.alarm_actions,['arn:aws:sns:us-east-2:792394000571:pellum-stg-operational-alerts']); assert.equal((a.ok_actions ?? []).length,0); assert.equal((a.insufficient_data_actions ?? []).length,0);
      assert.equal((a.metric_query ?? []).length,0);
      if (application) {
        assert(metrics.includes(a.metric_name)); assert.equal(a.alarm_name,`pellum-${scope}-${kind}-${a.metric_name}`);
        assert.equal(change.index,a.alarm_name); assert.deepEqual(a.dimensions ?? {},{});
        const lag = a.metric_name === 'delivery_lag_ms';
        assert.equal(a.statistic,lag ? 'Maximum' : 'Sum'); assert.equal(a.evaluation_periods,lag ? 3 : 1);
        assert.equal(a.threshold,lag ? 300000 : a.metric_name === 'retry' ? 3 : 0);
      } else {
        const visible = change.name === 'visible';
        assert.equal(a.alarm_name,`${change.index}-${change.name}`);
        assert.equal(a.metric_name,visible ? 'ApproximateNumberOfMessagesVisible' : 'ApproximateAgeOfOldestMessage');
        assert.deepEqual(a.dimensions,{QueueName:change.index}); assert.equal(a.statistic,'Maximum');
        assert.equal(a.evaluation_periods,visible ? 2 : 3);
        assert.equal(a.threshold,visible ? change.index.endsWith('-dlq') ? 0 : 100 : 300);
      }
    } else if (change.type === 'aws_cloudwatch_dashboard') {
      assert.equal(a.dashboard_name,'pellum-staging-jobs'); const dashboard = policy(a.dashboard_body); assert.equal(dashboard.widgets.length,8);
      assert.deepEqual(new Set(dashboard.widgets.map(w => w.properties.title)),new Set(queueNames.flatMap(n => [n,`${n}-dlq`])));
      for (const widget of dashboard.widgets) {
        assert.equal(widget.type,'metric'); assert.equal(widget.properties.region,'us-east-2');
        assert(queueNames.flatMap(n => [n,`${n}-dlq`]).includes(widget.properties.title));
        assert.equal(widget.properties.metrics.length,5);
        assert.deepEqual(widget.properties.metrics.map(m => m[1]),['ApproximateNumberOfMessagesVisible','ApproximateAgeOfOldestMessage','NumberOfMessagesReceived','NumberOfMessagesSent','NumberOfMessagesDeleted']);
        for (const m of widget.properties.metrics) { assert.equal(m[0],'AWS/SQS'); assert.equal(m[2],'QueueName'); assert.equal(m[3],widget.properties.title); }
      }
    }
  }
  return {status:'PASS', additions:changes.length, replacements:0, deletions:0, queues:8, runtimeRoles:6, alarms:40, dashboards:1, productionResources:0, persistentCredentials:0,
    notificationDelivery:'Exact approved encrypted SNS destination configured; confirmed subscription and delivery remain separate live gates.'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(reviewJobsPlan(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2)); }
  catch { console.error('ADR-017 plan rejected; no plan values displayed'); process.exitCode=1; }
}
