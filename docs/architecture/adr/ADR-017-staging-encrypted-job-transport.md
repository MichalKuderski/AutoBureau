# ADR-017: Encrypted staging job transport within the infrastructure budget

**Status: Approved by the founder for staging; not yet deployed.** September 13, 2026. The founder's direct approval authorizes a staging apply only after the live identity, isolation, cost, remote-state and separately saved additions-only plan gates pass. No Production transport, continuous workers, real document processing, model processing, live financial provider mode or paid upgrade is authorized. ADR-016 remains a separate storage plan.

## Evidence

The free Ohio `pellum-staging-events` Upstash database passes TLS connectivity, expiring atomic deduplication, consumer-group recovery, acknowledgement and retention-trimming probes. All synthetic keys are removed; the database has zero keys. No application credentials were distributed.

Current [Upstash security documentation](https://upstash.com/docs/redis/features/security) limits ACLs to paid databases and provider-managed encryption at rest to Prod Pack. The dashboard offers an upgrade for encryption at rest. [Pricing](https://upstash.com/pricing/redis) lists Prod Pack at **an additional $200/month per database**, unavailable on Free. That exceeds the founder's $100 monthly staging infrastructure limit before other services. The free database is suitable for these synthetic probes, not evidence that doc 12's encryption requirement is satisfied.

Do not silently weaken at-rest encryption, share staging credentials with Preview, purchase an upgrade, or move real tenant work onto this database.

## Approved decision

Keep Postgres's transactional outbox as the authority and use encrypted Amazon SQS Standard queues for staging job delivery. This changes the transport choice in ADR-005 for staging only. It does not change producers, tenant boundaries, event contracts, auth rate-limit storage (ADR-013) or API idempotency storage (ADR-012). Production's transport is undecided by this proposal.

The approved initial queue inventory, all in account `792394000571`, region `us-east-2`, is:

- `pellum-stg-pipeline` and `pellum-stg-pipeline-dlq`
- `pellum-stg-notifications` and `pellum-stg-notifications-dlq`
- `pellum-preview-pipeline` and `pellum-preview-pipeline-dlq`
- `pellum-preview-notifications` and `pellum-preview-notifications-dlq`

Each queue uses explicit SSE-SQS encryption, HTTPS/SigV4, an explicit TLS-deny resource policy, and exact queue-scoped roles. No public, cross-account, cross-environment or Production principal can send, receive, delete, purge or administer messages. Runtime consumers cannot administer queues or assume deployment roles. No persistent access keys. Queue roles and grants must be enumerated in their own reviewed additions-only plan, never appended to ADR-016's storage plan.

Messages contain only a validated, versioned envelope of opaque event/tenant identifiers and event type. No document content, identifier-grade values, financial-provider tokens, email addresses, signed URLs or arbitrary metadata. SSE-SQS protects message bodies, not all queue metadata; sensitive values must not appear in queue names or message attributes.

Fan-out is explicit: each required logical consumer gets its own durable delivery record, unique on event and consumer. A crash after send but before recording success may duplicate delivery. Consumers use a transactional inbox/unique domain key; a Redis-style `SETNX` before an effect is not proof of completion. A handler never publishes directly. Dispatch claims and acknowledgements are short database transactions, with network I/O between them. Successful delivery to one consumer cannot mark all consumers complete.

Main queue retention is seven days; DLQ retention fourteen days. Before apply, derive visibility from the implemented worker execution deadline/SLO, including measured or explicitly bounded acknowledgement/network margin. Support bounded extension where appropriate. Twenty-second long polling, three failed receives before DLQ, capped concurrency and no automatic DLQ replay remain required. A workflow requiring strict ordering must stop until ordering is explicitly designed. Processing, retries, retention/reconciliation and deletion receipts need real failure-injection evidence. Queue expiry alone is not proof of privacy deletion; removed-household jobs must fail closed and the pending-envelope cleanup/receipt design must be verified before processing is enabled.

Every queue needs staging observability: visible depth, oldest-message age, DLQ depth and receive counts; application send/processing failures, retry/exhaustion counts, delivery lag and reconciliation mismatches. Use bounded-cardinality dimensions with no tenant identifiers or arbitrary payloads. Configure alarms where practical without enabling continuous workers merely to produce telemetry. Runtime roles cannot administer/purge queues, change IAM, assume deployment roles or access unrelated queues.

## Cost and pre-apply gates

[SQS pricing](https://aws.amazon.com/sqs/pricing/) has no minimum fee and lists one million free requests monthly, shared across regions. Empty polling and retries consume requests; this is not a guaranteed zero-cost deployment. Verify current Ohio prices, actual shared usage, credit eligibility, worker/network/log/monitoring costs and budget alerts after AWS access returns. Do not authorize continuous workers from a queue-cost estimate.

Before any apply: reverify live account/region and every queue/role name; prepare exact IAM boundaries and encrypted remote-state ownership; review a separately saved additions-only plan and its effective cost envelope. Include current Ohio SQS rates, visible shared free-tier usage, compute, logs/metrics, networking, retries/empty polling and the existing migration host. The approved ceiling is $100/month; alerts are required where practical but are not a spending cap. No deletion, replacement, Production trust or unrelated change is permitted. SQS's encryption behavior is documented [here](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html).

Required probes include anonymous/foreign-role/cross-environment denial, encrypted queue read-back, duplicate and reordered delivery, lease expiry, crash before/after send, crash before/after domain commit, poison-message DLQ, bounded retry, multi-consumer fan-out, tenant mismatch, deleted-household refusal, exact fixture cleanup and reconcilable delivery/audit counts.

The free Upstash database remains empty for synthetic compatibility research; do not delete it or upgrade it as part of this decision. Intake and model/worker processing remain disabled. Safe pre-provider redaction, worker isolation and end-to-end document processing retain their independent hard gates.

## September 13 implementation and evidence boundary

The initial worker implementation is a bounded, single-message **database-only synthetic harness**, not a continuously running scanner or processing service. Its budget is 30 seconds for the receive call (including 20-second long polling), 2 seconds DB acquisition, 5 seconds domain transaction and 10 seconds acknowledgement. A 25% margin gives 58.75 seconds, rounded to a 60-second visibility lease. One extension is permitted, with a 120-second total receipt lifetime and a 10-second network margin. SDK calls make one attempt; durable retry limits are explicit. A scanner or other slow provider step must derive a new execution/lease budget before activation.

`job_deliveries` is unique on event and logical consumer; `job_inbox` is unique on delivery. Both use forced household RLS. A worker has SELECT on delivery authority and append-only inbox permission, cannot mark another consumer done, and serializes a delivery with a transaction-scoped lock before committing effect/outbox/inbox together. The new worker DB role is NOLOGIN and NOBYPASSRLS. No worker credential is distributed. Legacy and Production outbox rows keep null transport scope; only the staging issuer with the exact Vercel hosting environment stamps new staging/Preview intent.

The strict version-1 envelope contains event ID, household ID, event type and logical consumer only. Unknown keys and message attributes are refused. No payload, trace metadata or receipt handle is logged. The SQS adapter validates the exact Ohio account/project/role/scope and refuses persistent credential configuration and enabled document intake. It has no background loop.

The separate Terraform module proposes 69 additions: eight queues, eight queue policies, six runtime roles, six inline policies, forty alarms and one dashboard. Standard queue retention, SSE-SQS, TLS denial, exact role/namespace boundaries and manual-only DLQ handling are enforced by semantic plan checks. An independent eight-resource bootstrap provides encrypted/versioned retained S3 state, protected DynamoDB locks and bounded deployment/runtime authority. Existing ADR-016 state and plan are not extended. The two original verified Vercel scopes and immutable GitHub staging subject remain the source for exact trust.

Local tests currently prove duplicate/reordered handling, independent fan-out, lease/retry limits, crashes around send/domain commits, tenant/scope/deleted-household refusal, and restricted-role behavior. These are not live SQS or stable-staging lifecycle proof. The bootstrap change set is saved for review and not executed. Cost/alert delivery, actual temporary federation, exact saved live Terraform plan, effective-policy read-back and the full synthetic provider probe suite remain separate pre/post-apply gates.
