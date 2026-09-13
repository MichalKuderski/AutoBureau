# Staging infrastructure cost envelope — September 13, 2026

Current ADR-016/017 scope, account `792394000571`, Ohio `us-east-2`. This supersedes the September 12 continuous Fargate/NAT proposal: continuous workers, NAT and model processing are not authorized or allocated here. ADR-016 storage is live; ADR-017 is still a proposed separate apply.

| Component | Basis | Monthly USD |
| --- | --- | ---: |
| Existing migration t3.micro | 744 hours x $0.0104 | 7.74 |
| Existing public IPv4 | 744 hours x $0.005 | 3.72 |
| Existing 8 GiB gp3 | 8 GiB x $0.08 | 0.64 |
| SQS requests including retries/empty polls | 100,000 requests x $0.40/million; free tier ignored | 0.04 |
| CloudWatch standard alarms | 40 alarms x $0.10 | 4.00 |
| Custom metrics | 40 bounded series x $0.30; full-month upper allowance | 12.00 |
| Dashboard | One dashboard; conservative allowance | 3.00 |
| Storage, state locks and requests | Bounded synthetic and state usage allowance | 3.00 |
| Logs/metric API calls | Allowance; no unbounded payload logs | 2.00 |
| Network | Synthetic transfer allowance; no NAT or new IPv4 | 2.00 |
| Worker/model compute | No continuous compute or model calls authorized | 0.00 |
| Existing Upstash | Free, empty, unused | 0.00 |
| Encrypted operational alerts | KMS key/rotation reserve, one probe alarm and bounded SNS/KMS calls | 4.00 |
| Other providers | Unallocated reserve; no paid upgrade authorized | 25.00 |
| **Planning envelope** | 744-hour month; credits/free requests ignored | **67.14** |
| **Headroom below $100** | Planning reserve, not a spending cap | **32.86** |

The AWS-only envelope is $42.14. The $25 other-provider reserve is an allowance, not a verified invoice. No paid provider upgrade is included or authorized. The existing migration host and its unencrypted 8 GiB volume remain unchanged. No continuous worker, NAT gateway, new public IPv4, model invocation or real-data ingestion is included. Future compute must reopen this envelope and its approval gate.

Fresh Ohio Price List reads at 2026-09-13T21:30:39.368229+00:00 confirm Standard SQS $0.40/million, t3.micro $0.0104/hour, gp3 $0.08/GiB-month, standard alarms $0.10/month and first-tier custom metrics $0.30/month. Dashboard, logs/storage/network lines are explicit conservative allowances. Shared free-tier usage reports two SQS requests of one million and $94.68 remaining credits, expiring February 28, 2027. Credits do not reduce the recurring estimate.

Empty receives, retries and visibility operations count toward requests. There is no background poller; the authorized probe driver is bounded. The 100,000-request allowance is an operating budget, not a service-side hard cap. Envelope bodies are below 512 bytes. A future continuously polling worker would require a new measured request/compute forecast.

**Open cost evidence:** Cost Explorer returns AccessDeniedException, so actual month-to-date invoice costs are not proven. The $100 monthly `pellum-staging-monthly` budget was created and read back HEALTHY on September 13 at 23:05 UTC, with actual-spend thresholds 50/80/100% and forecast threshold 100%, routed to the founder-approved recipient. Credits/refunds are excluded; no budget actions or paid reports are enabled. The new budget reports zero spend, which does not prove the invoice. Forty queue/application alarms are proposed with an exact encrypted SNS destination; subscription confirmation and delivery remain unproven. Budget/alert delivery remains a staging readiness item; alerts are never a hard spending cap. Do not claim full operational observability until delivery is tested.

Evidence: [calculated receipt](evidence/adr017-cost-envelope-20260913.json). Sources: [SQS pricing](https://aws.amazon.com/sqs/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [EBS pricing](https://aws.amazon.com/ebs/pricing/). Live AWS pricing and inventory snapshots are retained locally without credentials.

The $4 alert allowance covers a customer-managed KMS key ($1/month initially, up to two additional rotation charges), the $0.10 probe alarm and bounded notification/API calls. [KMS pricing](https://aws.amazon.com/kms/pricing/), [SNS pricing](https://aws.amazon.com/sns/pricing/) and [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) were checked September 13. This adds no continuous worker or paid provider plan.
