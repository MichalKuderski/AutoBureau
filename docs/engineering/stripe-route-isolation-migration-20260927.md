# Stripe TEST route policy forward fix

The September 27 continuation reproduced a violation of ADR-020 on runtime
`22f397d1648b392181f720fc115c3482dbbefd9f` (tree
`c053eb26189e05d4081b147bf53b2c359028f61b`). The permissive PUBLIC household policy
on `stripe_test_routes` ORed with the billing digest policy. A billing connection
that set household scope could enumerate both household routes without the digest.
The new restricted-login regression failed all three expected visibility assertions;
the four earlier checkout tests passed. This was a product defect, not a timeout.

## Change and migration identity

`20261003000001_stripe_route_digest_isolation` changes only the roles of
`stripe_test_scope` to `app_user`, `app_retention_worker`, `app_deletion_verifier`.
The billing role retains the existing exact-digest SELECT policy and column grants.
Owner binding publication and privacy inventory keep their household scope. No rows,
columns, functions, grants, role attributes, provider settings or ledger privileges change.
No SECURITY DEFINER or BYPASSRLS authority is added.

Migration 46 has already been applied to staging; it is not edited. Its SHA-256 stays
`d297aada49cfd8a6341c4187ba01144c950c2413c6477549280e882a7717875b`.
The Stripe-only fix candidate had 47 migrations. The subsequent Plaid route fix adds
migration 48; the combined staging delta is 46→48. Derive every expected checksum from that exact
candidate and compare every already-applied ledger entry before dispatch.

## Locks, row impact and preflight

The transaction acquires the same ACCESS EXCLUSIVE table lock needed by ALTER POLICY
before inspecting the old policy definitions, preventing a check/change race.
`lock_timeout=5s` and `statement_timeout=60s` bound the operation. It requires forced
RLS and precisely the two reviewed original policies; any drift aborts atomically.
At 100,000 households the change still inspects two policy catalog rows and rewrites
zero tenant rows; lock acquisition depends on live transactions, not estimated table size.

Fresh read-only staging inspection in this continuation found project
`kdqnfruwgocfqwpbpuxo`, PostgreSQL 17.6, 46 completed migrations, no rollback or
unfinished migration, the vulnerable policy definition, zero Stripe checkouts/routes/
bindings, `app_billing_test` NOLOGIN/NOSUPERUSER/NOBYPASSRLS and TEST activation false.
These are timestamped observations, not permission to skip the immediate preflight.

Before staging application: verify the project identity and exact candidate; compare
all 46 checksums; capture policy/grant/function posture and row counts; confirm no
unexpected drift or active lock contention; leave protected accounts untouched.
Rehearse the combined 46→48 delta with populated synthetic Stripe and Plaid route rows on PostgreSQL 17 and verify
unchanged row fingerprints, grants, functions and all unrelated policies.

Apply only through the reviewed `deploy.yml` staging migration path after exact-candidate
positive and mutation evidence passes. If an environment exception is needed, add only
the exact candidate branch and remove it after the authorized run. Read back the ledger,
policy roles and unchanged data. Deploy with billing disabled; activation is a separate
dependency and lifecycle gate. Production remains closed.

## Failure and recovery

A lock timeout or unexpected posture stops the migration and deployment for investigation.
Preserve failed receipts. Do not edit the applied migration, fabricate ledger completion,
or revert to the vulnerable policy. Forward-fix schema only. Application rollback/disable
keeps `BILLING_TEST_DISABLED=1` on both runtimes and preserves all provider-work journals.

The focused local suite passes 10/10 after this migration, including direct owner-ID,
lease, revision, deletion-fence and privilege assertions. This is working-tree regression
evidence; the final candidate still requires a clean full run, source/DB mutations,
secret scans, staging rehearsal and hosted acceptance. Hosted Stripe lifecycle is open.
