# ADR-017 staging continuation — September 13

Status: implemented locally; no SQS resource or worker deployed. PR #5 remains draft. Document intake and real/model processing remain disabled.

Completed local checks: build, typecheck, lint (script console warnings only), 1,070 unit tests, 70 DB integration tests and 373 web integration tests. The database suite includes real restricted-role transaction/crash/isolation checks and provider API-role TRUNCATE denial. Infrastructure checks cover 18 bootstrap controls, 23 saved-plan negative controls, 3 signed workflow-identity controls and 2 Terraform mock tests. These evidence classes are distinct from provider probes.

The first broad unit attempt failed because the sandbox prohibited local JWKS listeners. The loopback-enabled rerun passes without assertion changes. The first web integration command omitted local connection variables and was stopped; the explicit verified local PostgreSQL 18 run passes. GitHub CI uses PostgreSQL 16 and must independently pass after commit.

## Migration order

1. Hold PR #5 Preview with `staging-schema-pending`; keep CI active.
2. Commit the three forward migrations, job foundation and exact staging workflow. No shared-history rewrite.
3. Require clean CI before `adr017-jobs-migrate` on PR #5's exact protected merge ref.
4. The migration-only job verifies staging target, existing migration checksums, 10 completed migrations, 19 forced RLS tables, 25 policies, zero queued outbox rows and small table size. It hashes existing public application rows in Postgres; no row contents enter artifacts.
5. Apply three migrations: delivery/inbox foundation; membership read required by existing household RLS; removal of residual provider API table grants/defaults. This last hardening change follows live discovery of unnecessary TRUNCATE/REFERENCES/TRIGGER grants. It does not alter app_user's existing capabilities or provider-owned schemas.
6. Read back 13 completed migrations, 21 forced RLS tables, 27 policies, no ensure_rls trigger, unchanged existing data/roles/ownership/policies/FKs, empty new tables and no provider API table privileges. The worker role stays NOLOGIN. Do not continue if any unexpected difference appears.
7. Remove the Preview hold only after successful read-back. Deploy/accept Preview, then later deploy the exact final candidate to stable staging; neither is authorized as Production application deployment.

## Infrastructure order

The separate bootstrap template passes cfn-lint, CloudFormation Guard and AWS template/IAM validation. IAM validation's audience-type suggestions are checked against the already verified string audience. The saved CloudFormation change set has only eight intended additions and is not executed. No SQS queue exists in the latest inventory. Reverify account, region, names, budget context and unrelated infrastructure immediately before any execution.

Establish alert/budget delivery where practical, execute the exact reviewed state/bootstrap change set only after its gates, and verify effective state encryption/access/role boundaries. The plan job uses signed GitHub OIDC and the new bounded jobs deployment/state roles. Save the binary Terraform plan and source SHA, review exactly 69 additions, and derive the short-lived apply grant from that exact plan. No apply workflow or write grant is yet present. Never reuse the ADR-016 saved plan/grant.

After apply, perform effective policy and synthetic queue probes under both Vercel scopes. Tests must cover exact receive/delete/send, modified/forbidden identity contexts, visibility extension/expiry, poison DLQ, fan-out and DB crash/inbox semantics together. Real foreign-token denials must not be inferred from policy simulations. Use only opaque synthetic envelopes; clean up exact fixtures and reconcile counts. Keep Upstash empty and all continuous workers/intake/model processing off.

Cost evidence is in [the current envelope](staging-infrastructure-cost-plan.md). Console alarms have no configured recipient; notification delivery is unproven. Cost Explorer does not expose current invoice totals. These must remain in the risk register, not be hidden by free credits.
