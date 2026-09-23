# Fail-closed staging SNS subscription evidence

A subscription is not confirmed merely because its ARN field differs from
`PendingConfirmation`. A `Deleted` sentinel, missing attributes, incomplete page,
duplicate subscription or inconsistent topic counters cannot pass the staging gate.

`scripts/staging-alert-subscription.mjs` reviews complete read-only API snapshots:
ListSubscriptionsByTopic, GetSubscriptionAttributes for a real subscription ARN,
and GetTopicAttributes. It requires exactly one email subscription at the approved
staging topic/account, matching recipient and ARN, explicit non-pending state, no
filter, and confirmed/pending/deleted counters of 1/0/0. The recipient is supplied
by the caller and is not included in returned evidence or assertion messages.

The pure parser runs no AWS commands and changes no subscription. Twenty-one
synthetic positive/negative cases run in the existing local CI guard step. Even
successful validation returns `notificationDeliveryProven: false`. Encryption,
effective policies and CloudWatch → SNS → mailbox delivery require separate live
read-back and an actual approved-recipient receipt. No live status was established
in this increment, and no alert, subscription, queue, budget or AWS configuration
was changed.

References reviewed September 20:
- [Subscription attributes](https://docs.aws.amazon.com/sns/latest/api/API_GetSubscriptionAttributes.html)
- [Topic counters](https://docs.aws.amazon.com/sns/latest/api/API_GetTopicAttributes.html)
