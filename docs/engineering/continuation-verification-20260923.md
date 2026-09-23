# Durable Plaid, upgrade compatibility and authenticated browser QA — local verification, September 23, 2026

**Pre-production decision: NO-GO.** Local exact-candidate verification passes, but required
implementation and every hosted/provider/legal gate remain. This is local evidence only.

## Provenance

The working copy arrived as a filtered, git-less snapshot of upstream
`57d079082e6a4b1854bab4d8f411300bab434f4f`. All 763 files matched `SOURCE_MANIFEST.json`
and the recomputed git tree equals upstream tree `a5bac62ce2a6f0ef660b6b1fe5b8a9a7c9fa2b93`.
A local repository was initialized over it (baseline commit `1dc268d`, same tree). **Local
commit SHAs below do not exist upstream; map evidence by tree hash.** Nothing was pushed.

`57d0790` was not documentation-only relative to the last reported tested SHA `1ed927d`: it
adds the local Plaid exchange and runtime-guard search-path migrations. The prior session's
validation of it never completed and its composed ClamAV proof had failed (`queued`). At the
baseline here, the full suite passed, including that proof in isolation (26 s); the earlier
failure is retained as an unresolved contention observation, not closed.

Tested candidate: **`5bc8fe7b16b5252a8893969d1a9fa238ff1e4a9a`**, tree
`4b4ae8eda91b4885790e61c1e8bac77461f9ca5b`, branch `codex/review-pellum-hardening-v2`.

| Commit | Change |
| --- | --- |
| `1dc268d` | Baseline import (tree `a5bac62c`) |
| `d853bae` | Plaid durable local lifecycle (migration, module, runtime composition, tests) |
| `01d3386` | ADR-022 amendment, retirement catalog entry |
| `03a7319` | Retention-coverage classification (an existing control correctly failed `01d3386`) |
| `5435d39` | Read-only upgrade preflight, control test, staging workflow wiring |
| `7c13fe3` | Staging upgrade compatibility note |
| `5bc8fe7` | Accessibility fixes from authenticated browser QA |

## What changed

**Durable Plaid (ADR-022, local).** Non-enumerating webhook routing (digest-keyed, one
fixed callback-free resolver); verified-signal inbox storing only digest + closed signal;
one DB-time lease per Item; bounded atomic cursor+data sync with restart-from-original-cursor;
status projection; owner reconnect/unlink intents; compare-and-swap envelope rotation;
single-attempt removal with distinct acknowledged / provider-invalid / indeterminate outcomes;
non-mutating reconciliation; deletion-fence (erasure-direction only) integration; five new
forced-RLS journals inventoried and counted by the provider observer. Details and the exact
authority changes are in the ADR-022 amendment.

**Migrations.** Staging-shaped upgrade from the recorded 13-migration staging schema passes on
PostgreSQL 18 and 16 with pre-existing data unchanged, and the upgraded schema equals a fresh
install. A mid-chain opaque refusal was found and addressed with a read-only preflight — see
[staging-upgrade-compatibility-20260923.md](staging-upgrade-compatibility-20260923.md).

**Authenticated browser QA.** Real sign-up, onboarding, sign-out/in, server-side refresh,
member allowance and dialogs were exercised in Chromium against the production build and a
GoTrue-shaped loopback issuer. Four accessibility defects were fixed (unlabeled search
fields, unlabeled command-palette combobox, h1→h3 heading skips on seven pages and Settings,
320 px loading-skeleton overflow).

## Defects found

1. Retention coverage missing the five new Plaid models — caught by an existing control.
2. PostgreSQL regex repetition limit (`{1,256}`) in a new CHECK — raised at runtime; replaced
   by a length bound + alphabet check.
3. Guard expression referencing a column absent on one of its tables — fixed by statement split.
4. `deletion-journal.ts` template literal broken by an edit — caught by the full build.
5. Two mutation "detections" were incidental; the parallel run was invalid (hook race). Both
   gaps received targeted tests; all ten weakenings are now detected in serial complete runs.
6. Opaque mid-chain migration refusal on nonzero legacy usage (operational).
7. Four accessibility defects above; one UX gap (sign-up name not reflected until onboarding).

## Validation at `5bc8fe7`

| Check | Result |
| --- | --- |
| Frozen offline install / build / typecheck | PASS |
| Lint | 0 errors, 13 existing warnings |
| Unit | 1,982 passed |
| Restricted-role integration | 832 passed (351 DB + 481 HTTP) |
| Controls / guards | 205 / 7 passed |
| Fresh DB readback | 34 checksum-matching migrations, 47 forced-RLS tables, 65 policies, 0 SECURITY DEFINER, 0 runtime-owned tables, 0 memberships, 0 runtime CREATE on trusted schemas, 42 guards pin `pg_temp` last, TEST activation false |
| Real ClamAV composed lifecycle | 1 passed (isolated) |
| Plaid guard mutations | 10/10 detected (57 tests, 0 skipped each) |

Posture diff against the baseline: +5 tables, +12 invoker functions, one changed function
body (`guard_plaid_effect`), +2 table DELETE grants and column grants only to the Plaid
runtime, `app_user` and the two privacy roles. No role, membership, schema-CREATE,
SECURITY DEFINER or BYPASSRLS change; `app_dispatcher` remains the only reviewed bypass role.

The machine-readable receipt is
[evidence/continuation-native-20260923.json](evidence/continuation-native-20260923.json).

## Remaining blockers and exact next order

1. **Export and deletion are disabled in the UI** (founding invariant 10). Build the reviewed
   originals archive + JSONL/manifest export and the user deletion request flow on existing
   seams; keep identifiers omitted until the narrow reveal path is proven; no final receipt.
2. Journal retirement executor (bounded, leased, hold-aware, independent absence) behind
   ADR-019 authority, which itself remains unimplemented.
3. Plaid: operational KEK/KMS and process isolation, administrative-suspension lock protocol,
   update-mode link issuance, consent UI, derived-record retention decision (PRD), export
   category; then operator-authorized Sandbox lifecycle evidence.
4. Document lifecycle UI (old-period resolution, cancellation, reminders).
5. MFA/recovery browser verification (extend the local issuer), screen-reader and
   cross-browser passes.
6. With operator authorization: run the upgrade preflight against stable staging, then the
   exact-SHA hosted PG17 migration/readback and full hosted acceptance; Stripe TEST and Plaid
   Sandbox provider lifecycles; observability, capacity and cost evidence.
7. External: Supabase 504 causality and historical token invalidation (packet PREPARED BUT
   UNSENT), legal operator/jurisdiction/contacts/ToS/privacy/DPAs, external security review,
   incident response/on-call, backup/restore drills.

No push, PR, deployment, hosted migration, provider mutation, Production access, real data,
model call, DNS change or support submission occurred. The production migration job was not
changed; adding the preflight there requires separate authorization.
