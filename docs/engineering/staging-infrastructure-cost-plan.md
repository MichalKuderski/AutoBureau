# Staging infrastructure cost envelope — September 12, 2026

**Planning estimate; no resources provisioned.** Authorized AWS account `792394000571`, Ohio `us-east-2`. Monthly ceiling: $100. The founder's reported $95.10 credits expire February 28, 2027 or when exhausted; they do not lower the recurring prices below.

The read-only inventory contains one existing running Linux t3.micro, `AutoBureau-Staging-Migration`, launched September 1, with one public IPv4 and an 8 GiB gp3 volume. The volume reports unencrypted; its contents were not inspected and it was not changed. No ECS clusters, NAT gateways, load balancers, ECR repositories, RDS/Redis instances, CloudWatch log groups, customer KMS aliases or OIDC providers were returned. The Budgets read returned no budget entries; no notification or hard cost-control claim is made.

Use a 744-hour month rather than relying on free credits or a short test window:

| Component | Basis | Monthly USD |
| --- | --- | ---: |
| One private Fargate ARM task, 0.5 vCPU / 4 GiB | Ohio $0.03238/vCPU-hour + $0.00356/GiB-hour | 22.64 |
| One NAT gateway | $0.045/hour | 33.48 |
| NAT public IPv4 | $0.005/hour | 3.72 |
| Existing migration t3.micro | Ohio Linux $0.0104/hour | 7.74 |
| Existing host public IPv4 | $0.005/hour | 3.72 |
| Existing 8 GiB gp3 | Planning allowance at $0.08/GiB-month | 0.64 |
| Upstash Redis allowance | Fixed 250 MB tier; account/plan not yet selected | 10.00 |
| Secrets/KMS allowance | Up to six mirrored secrets + one field-encryption key | 3.40 |
| Storage, requests, logs, registry and transfer allowance | Bounded synthetic staging traffic; measure actual usage | 10.00 |
| **Working envelope** | Rounded line items; exact unrounded total | **95.34** |

Only the Fargate and t3.micro rates were additionally read from AWS's current Ohio price-list API. Other rows use the linked public pricing or explicit planning allowances. This is not an AWS quote or a guaranteed cap. It excludes unknown existing Vercel charges, Supabase upgrades, tax and model inference. Consequently it is **not yet sufficient to authorize continuous hosting under an all-provider $100 ceiling**. Verify the correct Vercel team's plan, actual Redis requirements and a small model test budget, then reduce the allocation before provisioning if necessary.

No ALB is allocated for the asynchronous v1 worker: public chat/SSE is deferred by the approved PRD. Any synchronous AI service exposure would reopen both the architecture and cost review. The single small worker must be measured with ClamAV loaded before its capacity can be accepted; a memory failure must not be hidden by silently doubling resources. The private subnet/NAT security shape remains intact. A same-region S3 gateway endpoint would avoid NAT data-processing charges for quarantine traffic if ADR-016 is accepted.

Before apply: establish the tagged monthly budget and verified alert destination, concurrency/desired-count limits, storage retention, log retention and transfer/request assumptions. Do not reuse or shut down the existing migration host without proving its dependency status. Do not reserve capacity or commit to a Savings Plan. Cost alerts can lag and do not stop billing automatically; preserve headroom and test the scoped stop/rollback procedure.

Sources: [Fargate](https://aws.amazon.com/fargate/pricing/), [Ohio ECS price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-2/index.json), [VPC/NAT/IPv4](https://aws.amazon.com/vpc/pricing/), [EBS](https://aws.amazon.com/ebs/pricing/), [Upstash Redis](https://upstash.com/pricing/redis), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [KMS](https://aws.amazon.com/kms/pricing/).
