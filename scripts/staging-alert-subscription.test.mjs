import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAlertSubscription } from './staging-alert-subscription.mjs';
import { topic } from './staging-alert-review.mjs';
const recipient = 'synthetic@example.test';
const arn = `${topic}:11111111-1111-4111-8111-111111111111`;
function fixture() {
  const s = { SubscriptionArn: arn, TopicArn: topic, Owner: '792394000571', Protocol: 'email', Endpoint: recipient };
  return { subscriptions: { Subscriptions: [s] }, subscriptionAttributes: { Attributes: { ...s, PendingConfirmation: 'false' } },
    topicAttributes: { Attributes: { TopicArn: topic, Owner: s.Owner, SubscriptionsConfirmed: '1', SubscriptionsPending: '0', SubscriptionsDeleted: '0' } } };
}
test('real confirmed ARN and consistent inventories still do not prove delivery', () => {
  assert.deepEqual(reviewAlertSubscription(fixture(), recipient), { confirmed: true, subscriptions: 1, notificationDeliveryProven: false });
});
for (const sentinel of ['Deleted', 'PendingConfirmation', '', 'confirmed', `${topic}:not-a-uuid`]) {
  test(`rejects non-ARN state ${sentinel.split(':').at(-1)}`, () => {
    const f = fixture(); f.subscriptions.Subscriptions[0].SubscriptionArn = sentinel;
    assert.throws(() => reviewAlertSubscription(f, recipient));
  });
}
const changes = {
  pending: f => { f.subscriptionAttributes.Attributes.PendingConfirmation = 'true'; },
  missingConfirmation: f => { delete f.subscriptionAttributes.Attributes.PendingConfirmation; },
  missingSubscriptionAttributes: f => { delete f.subscriptionAttributes.Attributes; },
  duplicate: f => { f.subscriptions.Subscriptions.push({ ...f.subscriptions.Subscriptions[0] }); },
  incompletePage: f => { f.subscriptions.NextToken = 'opaque'; },
  wrongRecipient: f => { f.subscriptions.Subscriptions[0].Endpoint = 'PRIVATE_RECIPIENT_CANARY'; },
  wrongAttributeRecipient: f => { f.subscriptionAttributes.Attributes.Endpoint = 'PRIVATE_RECIPIENT_CANARY'; },
  wrongTopic: f => { f.subscriptions.Subscriptions[0].TopicArn = 'foreign'; },
  wrongOwner: f => { f.subscriptionAttributes.Attributes.Owner = '000000000000'; },
  wrongArn: f => { f.subscriptionAttributes.Attributes.SubscriptionArn = `${topic}:22222222-2222-4222-8222-222222222222`; },
  wrongProtocol: f => { f.subscriptionAttributes.Attributes.Protocol = 'https'; },
  zeroConfirmed: f => { f.topicAttributes.Attributes.SubscriptionsConfirmed = '0'; },
  pendingDuplicate: f => { f.topicAttributes.Attributes.SubscriptionsPending = '1'; },
  deletedSubscription: f => { f.topicAttributes.Attributes.SubscriptionsDeleted = '1'; },
  filter: f => { f.subscriptionAttributes.Attributes.FilterPolicy = '{"unexpected":["filter"]}'; },
};
for (const [name, change] of Object.entries(changes)) test(`rejects ${name} without exposing recipient`, () => {
  const f = fixture(); change(f);
  assert.throws(() => reviewAlertSubscription(f, recipient), error => {
    assert.ok(!String(error).includes('PRIVATE_RECIPIENT_CANARY')); return true;
  });
});
