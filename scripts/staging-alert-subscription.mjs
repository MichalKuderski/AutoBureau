import assert from 'node:assert/strict';
import { topic } from './staging-alert-review.mjs';

const owner = '792394000571';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Review complete, read-only SNS API snapshots. A non-pending string (notably
 * "Deleted") is not a confirmed ARN. This never establishes email delivery or
 * encryption/policy correctness; those require their independent live evidence.
 * The caller supplies the approved recipient; it is never returned or logged.
 */
export function reviewAlertSubscription({ subscriptions, subscriptionAttributes, topicAttributes }, expectedRecipient) {
  assert.equal(typeof expectedRecipient, 'string');
  assert.ok(expectedRecipient.length > 0);
  assert.equal(subscriptions.NextToken, undefined, 'A paginated inventory is incomplete');
  assert.equal(subscriptions.Subscriptions?.length, 1, 'Require exactly one subscription');
  const s = subscriptions.Subscriptions[0];
  assert.equal(s.TopicArn, topic);
  assert.equal(s.Owner, owner);
  assert.equal(s.Protocol, 'email');
  // Assertions contain no recipient or raw snapshot on failure.
  assert.ok(s.Endpoint === expectedRecipient, 'Unexpected recipient');
  assert.equal(typeof s.SubscriptionArn, 'string');
  assert.ok(s.SubscriptionArn.startsWith(`${topic}:`) && uuid.test(s.SubscriptionArn.slice(topic.length + 1)), 'Require a real subscription ARN');
  const a = subscriptionAttributes.Attributes;
  assert.equal(a?.SubscriptionArn, s.SubscriptionArn);
  assert.equal(a.TopicArn, topic);
  assert.equal(a.Owner, owner);
  assert.equal(a.Protocol, 'email');
  assert.ok(a.Endpoint === expectedRecipient, 'Unexpected recipient');
  assert.equal(a.PendingConfirmation, 'false');
  assert.ok(a.FilterPolicy === undefined || a.FilterPolicy === '{}', 'Unexpected notification filter');
  const t = topicAttributes.Attributes;
  assert.equal(t?.TopicArn, topic);
  assert.equal(t.Owner, owner);
  assert.equal(t.SubscriptionsConfirmed, '1');
  assert.equal(t.SubscriptionsPending, '0');
  assert.equal(t.SubscriptionsDeleted, '0');
  return Object.freeze({ confirmed: true, subscriptions: 1, notificationDeliveryProven: false });
}
