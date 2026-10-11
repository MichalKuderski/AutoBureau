# Coordinated rejection rollout: staging-only delivery candidate

Local, unpublished proposal. No hosted migration, pause, workflow dispatch, GitHub
environment change, credential change, merge or deployment is authorized by this file.
PR16 keeps its schema hold. PR15 keeps its independent required-reviewer preview gate.

## Exact base and source dependencies

| Purpose | Commit | Tree |
|---|---|---|
| Main base; application code/schema and normal migration path remain unchanged | `3695e6cbb219d46674bbc5ffd891de2793fd002c` | `5e50f4558d52a4caa4d028eb9c315fc28d41f35f` |
| Frozen 48-file staging migration history (PR14) | `37fd91ac7d2f85a4559b271013de698c0499c135` | `7eccaa3e5d64ae555b1d8e088bcd2b6508e3f910` |
| Unchanged rejection-reason migration and separately tested runtime (PR16) | `4619bff4d3dfa8eb00dcff53d8a994ec54ccca5e` | `c22e1308d8d4f7e96e274d51f7bd8970bd3b6120` |

This candidate does not merge the application dependency chain. Main already contains
7 of the 48 applied staging migrations. The other 41 are copied byte-for-byte into
this isolated archive, along with the three rollout phase files. The manifest pins
every file's path and SHA-256. The application schema, packages, apps, lockfile and
ordinary `packages/db/prisma/migrations` directory remain exact main. Consequently
an ordinary production `prisma migrate deploy` cannot discover the archived staging
files. The archive is preserved as immutable migration evidence, not a new production
migration chain. A future unified staging migration path must retain this complete
history; it cannot discard or rewrite the two pause/resume ledger entries.

## Three separate approvals, one migration per attempt

| Phase | Filename prefix | SHA-256 | Completed ledger count |
|---|---|---|---|
| Pause and drain | `20261010235959_document_rejection_pause` | `de495201a37ef755a69bf0b89fb38001e9ca66eac8ab71f4173a0be2a84f2709` | 49 |
| Required reason | `20261011000000_document_rejection_reason` | `fc6773ad9d76251b467b49523efe55e6304e8fbd0f0a809ca0461900bddbb8d5` | 50 |
| Resume reason-aware writes | `20261011000001_document_rejection_resume` | `c1aad6b0fe330b93e0175c8fa170b683fa44212066af45202ad802107d1cf91a` | 51 |

The runner requires the exact preceding ledger, with no duplicate, failed, rolled-back,
missing, unexpected or changed-checksum entry. It stages only the immutable prefix
through the approved phase in a temporary Prisma directory. Later phase files are
absent from that directory. The initial proposal assumed a nonexistent lock file;
this candidate includes its own PostgreSQL `migration_lock.toml` and minimal migration
datasource, with no application model or generated-client change.

Pause adds `CHECK(decision <> 'discard') NOT VALID`. Its ACCESS EXCLUSIVE table lock
drains earlier journal writers before activation. Previously committed decisions
remain truthful historical rows. Transactions reaching the journal after the cutoff
cannot create discards, regardless of preview URL, client version or reason supplied.
No owner notice, UI flag or client-version exception is treated as enforcement.
Existing reads/replays and apply decisions remain available apart from brief DDL
locking. Immutable prior decisions are not scanned, backfilled or rewritten.

Every phase has a 5-second lock timeout and 60-second per-statement timeout. The workflow
also has a 10-minute job bound and the Prisma subprocess a 120-second bound. None of
these make cancellation outcome certain. A lock refusal, timeout, transport error,
failed precheck or failed postcheck stops without retry, repair or a later phase.
The pause persists until a separately approved resume; it is never cleanup code.
At 100k households these operations remain metadata-only, but contention still governs
lock acquisition and no hosted duration is promised.

The reason phase preserves the existing PR16 migration exactly: nullable text column,
NOT VALID closed-category check and one-column INSERT grant to the existing app role.
Historical null reasons stay null; no category is fabricated. Old PR14/15 discard
writes will fail closed permanently after this phase. This is not a seamless upgrade
for old clients.

After reason postchecks, separately authorize lifting PR16's deployment hold and queue
the reason-aware preview behind its existing reviewer gate. Verify its immutable URL,
head/tree, READY state, region, lack of aliases, auth/read behavior and expected paused
rejection refusal. Resume requires owner-recorded evidence for that runtime and its
acceptance run. Those inputs are attestations, not machine-fetched provider verification.
After resume, perform separately authorized synthetic restricted-role rejection,
accounting, retry/idempotency and tenant-isolation acceptance. No hosted E2E pass is
claimed here.

## Enforcement and postchecks

The staging connection guard permits only Supabase project `kdqnfruwgocfqwpbpuxo`,
database `/postgres`, direct host `db.kdqnfruwgocfqwpbpuxo.supabase.co` with `postgres`,
or the verified session host `aws-0-us-west-2.pooler.supabase.com` with
`postgres.kdqnfruwgocfqwpbpuxo`, port 5432. Transaction-pool port 6543 and loopback are refused by the hosted
entrypoint. There is no test-mode/target-bypass switch in that entrypoint. Integration
tests call the same orchestration module with a separate, explicit loopback-only
database adapter. No hosted credential is used for tests.

The migration runner reuses the diagnostic's reviewed public CA file and fixed PEM/DER
pins through `scripts/staging-migration-trust.mjs`. Its secret-free workflow preflight
checks the file, pins, CA capability and dates. The runner repeats verification before
constructing Prisma and reconstructs one URL with `sslmode=require`, `sslaccept=strict`,
the fixed absolute `sslcert` path, one connection and five-second connection/pool limits.
The pre/postcheck client receives that URL as `datasourceUrl`; the migration subprocess
receives the identical URL as its process-local `DATABASE_URL`, including when its
schema is staged in a temporary directory. The stored credential is not changed.
Unknown/duplicate options, routing overrides, permissive TLS settings, TLS identities
and arbitrary CA paths are refused before either engine starts. There is no OS-wide
trust change. The shared CA remains the 1,367-byte official public certificate with
PEM SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`,
DER fingerprint `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`
and expiry 2031-04-26 10:56:53 UTC. No private key is included.

The query and migration engines use Prisma's native TLS options; libpq's `verify-full`
is not substituted. CLI output is captured and discarded. Initialization, connection,
migration and cleanup failures retain the fixed stop message; success is emitted only
after disconnect completes. No raw driver error or credential is printed.

The preserved upgrade preflight runs in a bounded READ ONLY transaction. The runner
checks exact pause/reason constraint definitions and validation state, reason column
shape/grant, RLS/FORCE RLS, active journal triggers, the household policy, and app-role
ownership/bypass/update/delete restrictions. Existing constraints, policies and
triggers must remain unchanged across the phase. The lock snapshot is advisory;
the SQL lock is the actual drain. Rechecking ledger/schema after uncertain outcomes
is mandatory. No `migrate resolve`, down migration, privilege relaxation, session kill
or automatic rollback/forward repair is implemented.

## Main-only workflow and promotion prevention

The change to existing `deploy.yml` is an explicit temporary hold on its staging job:
`if: ${{ false }}`. It must land atomically with this delivery proposal. A merge/push
therefore cannot run that job, its migration step, Vercel build/deploy or stable-alias
promotion. Production and existing preview job definitions, triggers, permissions and
concurrency are pinned to exact-main hashes by tests. Their reviewer protections are
not changed. Re-enabling normal staging requires a later reviewed change.

The new migration-only workflow is dispatch-only, uses the existing main-only `staging`
environment, and restricts both original actor and rerun actor to MichalKuderski. It
checks a phase/exact-main-SHA/project approval string and owner decision reference.
It checks out the workflow's own main commit: no alternate-ref or downloaded PR code.
It has contents-read permission and exposes only the existing staging migration secret
at the migration step. It contains no production credential, Vercel token, deploy,
promote, alias, rollback or provider activation operation. No environment permission
or secret binding is changed. The existing environment has no required reviewer;
owner-only dispatch plus recorded explicit authorization is not represented as a new
independent reviewer gate.

The added ordinary CI job uses only a fresh local PostgreSQL service and synthetic
credentials. It has no hosted environment or secrets. It exercises the complete runner,
including the full 48-file baseline, before publication can be considered.

## Local evidence

- 27 planner tests: ordering, approval/ref/actor/rerun checks, exact inventory/ledger,
  failure stops and no retries.
- 6 workflow/boundary tests: merge/push staging hold, unchanged production/preview
  jobs, unchanged canonical production migration path/schema, manual main/owner
  restriction, no deployment commands/credentials/input interpolation, hosted
  entrypoint refusal of loopback, and isolated CI service only.
- 8 complete runner integration scenarios using real Prisma and the full schema:
  pause/reason/resume with 49/50/51 matching ledger rows; blind replay refusal;
  wrong phase/approval/checksum refusal; disabled RLS/trigger refusal; uncertain
  post-commit response; postcheck drift; injected pre-COMMIT rollback leaving failed
  Prisma history; a competing lock arriving after precheck causing the real timeout;
  and refusal to resume with a weakened reason constraint. Faults are injected only
  into disposable fixtures/staged copies, never tracked migration files.
- 57 existing PR16 document-result/period tests passed on the actual runner-produced
  51-entry schema, using restricted application/document-worker roles.
- Reconciled main candidate: full lint, build and typechecks; 955 workspace tests;
  330 database/web integration tests. No app, package, schema or lockfile changes.
- Earlier local pause-constraint tests additionally established drain behavior,
  no audit residue on denial, continued apply, preserved historical nulls and old
  reasonless-client refusal after resume.

All database evidence is local PostgreSQL 16.15, matching the repository's CI image.
Hosted staging reports PostgreSQL 17.6; local evidence does not prove its performance,
provider availability, backups or restore admission. The test cluster is disposable;
the original local container and other worktrees are not modified.

The added TLS suite is imported by `scripts/rejection-rollout.test.mjs`, so the existing
isolated rollout CI job exercises actual Prisma 6.19.3 query and schema engines
(`c2990dca591cba766e3b7ef5d9e8a84796e47ab7`) against disposable TLS-enabled loopback
PostgreSQL fixtures. A trusted DNS identity supports a query and a one-file synthetic
migration with ledger read-back; untrusted roots, expired/mismatched leaves and
missing/tampered CA files are refused. A test-only permissive hostname control proves
the refusal mechanism. Packaged entrypoint tests verify identical normalized URL
forwarding to both real engines, early pin/URL refusal, captured CLI canaries and
suppressed disconnect errors. Test-only constructors/CLI adapters change routing and
CA only within temporary fixture trees; no hosted override is provided.

Read-only diagnostic run 38179887258 passed on main `abd85bd7de684f6eee60cc5b2154ed0a0abed109`,
including the exact 48-entry baseline. That is diagnostic binding evidence, not a hosted
migration-engine test or phase authorization. Owner-reported backup status is **unknown**
and restore capability is **unverified**. This establishes neither absence of backups
nor acceptance of recovery risk. Recovery evidence/decision and separate exact-phase
approval remain prerequisites. This trust change does not lift any deployment/schema
hold or authorize a hosted workflow, SQL, migration, merge, preview or production action.

Reproduce the new tests with installed workspace dependencies, an empty isolated
pgvector PostgreSQL 16 cluster, and database `rollout_baseline` owned by local
`autobureau`. Set only `ROLLOUT_TEST_DATABASE_URL` to that loopback fixture for the
integration command; non-loopback targets and other baseline names are refused.

```
node scripts/rejection-rollout.test.mjs
node scripts/rejection-rollout-workflow.test.mjs
node scripts/rejection-rollout.integration.test.mjs
```

## Exact subsequent approval scope

Preparation and local testing are complete. The next decision is permission to publish
this exact main-based commit for independent review and CI. That is not merge or
execution approval. Record the actual candidate head/tree in the handoff; if main
moves, reconcile and revalidate rather than silently changing the approved base.

After review/CI, obtain separate approval for the exact merge candidate and its
documented automatic-staging hold. After merge, obtain one phase-specific dispatch
approval at a time, each naming the resulting exact main SHA/tree, target project,
file/hash above, one attempt, actual credential-binding verification without revealing
values, recovery evidence/risk decision and the known rejection-availability impact.
Reason requires verified pause; resume additionally requires the exact reason-aware
runtime URL/source tree/acceptance evidence. No approval implicitly authorizes runtime
deployment, provider activation, stable promotion or production.

Request only nonsecret owner recovery evidence: current exact-project backup status
and recoverable point/window (or none), existing isolated restore-drill outcome (or
untested), covered scope and recovery owner. Daily backups/PITR are explicit production
requirements. The runbook does not require operational ADR019 infrastructure merely
to run this additive staging DDL; it does require separate ADR019 admission before
restored data is served. Do not claim a backup listing or owner attestation establishes
that admission. Production backup/restore/admission gates remain open. Nothing here
authorizes a backup purchase, restore, destructive reset or admission-policy change.
