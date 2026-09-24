# Privacy workflows, Plaid hardening and document cancellation — local verification, September 23–24, 2026

**Pre-production decision: NO-GO.** The exact local candidate passes every local step, but
mandatory hosted-provider, independent-authority, legal/operator and incident gates are unmet,
and several engineering gates remain open (below). This is local evidence only.

## Provenance

Continues the git-less snapshot of upstream `57d079082e6a4b1854bab4d8f411300bab434f4f`
(tree `a5bac62c…`) with local history initialized over it. **Local SHAs do not exist
upstream; map evidence by tree hash.** The worktree was verified to contain `d853bae`,
`5435d39`, `5bc8fe7` and `c81c570` before work began. Nothing was pushed.

Tested candidate: **`fb6bd051fe83392530d8679d68edb2f7a5777828`**, tree `8d740bdcef1a3fb648659dbd9d031d8c9f122f8b`.

| Commit | Change |
| --- | --- |
| `f8ead9b` | Account-status fence closes the administrative-suspension race during an in-flight Plaid sync |
| `b8b3db6` | User-facing household deletion request, 14-day undo, status (no final receipt) |
| `879a071` | Manifest-bound erasure of members, entitlements, idempotency records |
| `d01505b` | Complete household export archive v3 (originals + JSONL + manifest), local synthetic vault |
| `10a655a` | User-facing export: prepare, download, delete |
| `535e0b3` | Focus after privacy actions; dark-theme danger contrast 2.89:1 → 6.0:1 |
| `5b39619` | Owner-chosen Plaid transaction-history retention after disconnect (default delete) |
| `e4b63d2` | Plaid consent, reconnect and disconnect UX; `financial.read`/`financial.manage` |
| `ddf6cd8` | KMS-shaped custody seam (fake-port tests only; **not KMS evidence**) |
| `9e76561` | ADR-022 amendment |
| `a86c5c9` | Lint fixes for two earlier commits (see defects) |
| `9f866d7` | Owner/member cancellation of unstarted document processing |
| `522bf87` | ADR-021 amendment |
| `fb6bd05` | Guard-inventory pin 43 → 44 |

## What changed, by priority

**1. Privacy export/deletion (founding invariant 10).** Export v3 is a store-only ZIP built
from one MVCC snapshot statement: `manifest.json` (SHA-256 per member, 17 categories,
explicit omissions and reasons), `README.txt`, `data/*.jsonl` and `originals/` read only
from clean custody and verified against the custody hash; AES-256-GCM at rest with
household/request AAD; verify-before-release download; three requests per 24 h. `complete`
is true only when nothing is omitted. Identifier values stay omitted (count only) until the
narrow reveal boundary is reviewed. Deletion is a real request with a 14-day undo window,
fence, manifest-bound erasure (now including household members, entitlements and idempotency
records) and status; `finalReceiptIssuable` stays false and provider/backup erasure is
reported as unverified. Protected journals (audit, outbox, processing, results, billing,
Plaid, deletion) are retained as suppression evidence. Storage is a local synthetic vault
mount that refuses production, Vercel/AWS runtime and non-loopback databases.

**2. ADR-019 independent authority.** Nothing new was built, and nothing legitimately can be
built locally beyond what exists: the ed25519 challenge/response verifier with one-use
challenges and an external monotonic checkpoint port (`restore-authority.ts`), which already
refuses any `unknown` subject and never enables activation (`activationAllowed:false`). The
remaining amendments (independent enrollment registry, restore manifest bound to backup and
scope, key custody/rotation/revocation, holds, partial/regional restore) need a separately
operated authority, and a selected provider with an approved packet. Substituting an
in-process map or application admin would violate the ADR. Journal retirement stays
unimplemented: ADR-019 forbids purges until authority and holds are approved.

**3. Plaid hardening.** Suspension race closed (exclusive/shared `account-status:` advisory
lock; tested in both orders). History after unlink is an explicit owner choice, default
delete, enforced by a deferred commit check. Owner consent/reconnect/disconnect UI. The KMS
seam binds the full Item identity as encryption context; persisting its envelope needs a
reviewed credential-schema amendment (the table pins the local 64-character wrapped-key
format). No KMS SDK, key or IAM exists; no provider call was made.

**4. Product workflows.** Owner/member cancellation of unstarted document work: the database
refuses cancellation once a reservation exists (a started read could otherwise strand an
uncommittable result), keeps bytes and accounting, and never deletes or retries. Old-period
results remain fail-closed pending the PRD §21 cross-period policy.
Not done: MFA/recovery browser lifecycle, screen-reader pass, cross-browser pass, reminder
and billing-grace screens.

**5. Hosted/provider verification.** None performed. No push authorization, no remote,
no authorized provider write credentials, and no permission to download PostgreSQL 17.

**6. Incident.** The Supabase 504 packet remains **prepared, NOT SENT** (no authorization
to submit). Provider root cause, historical token invalidation and OAuth revocation
confirmation remain open. Later successful requests are not evidence of closure.

## Defects found

1. Fenced-household reads returned a misleading "verify your account security" message;
   now an accurate `HouseholdFenced` response.
2. Focus fell to the document body after privacy dialogs completed; fixed.
3. Dark-theme danger button contrast 2.89:1 (fails AA); fixed (6.0/6.49:1).
4. The mutation harness took function bodies from the oldest migration, which would have
   produced false detections; now uses the latest definition in the chain.
5. `removed-keeps-chosen-history` mutation was initially undetected; a direct-SQL commit test
   was added and it is now detected.
6. **Two earlier commits this session (`10a655a`/`e4b63d2`) failed lint** (set-state in effect,
   unused import). They were never presented as candidate evidence; fixed in `a86c5c9`.
7. The owner-cancellation guard first intercepted the existing reviewed-completion path;
   caught by the document-results suite and narrowed to cancellation transitions only.

## Validation at `fb6bd05`

All 13 steps pass on a clean tree at the candidate: frozen offline install, build, typecheck,
lint (0 errors, 13 existing warnings), **2,002 unit** (baseline 1,982), **206 controls** (205),
7 guard steps, fresh migration of all 39 migrations, **367 DB + 495 HTTP = 862 restricted-role
integration** (832), posture readback, and the composed **real-ClamAV proof 1/1**.

Posture diff against `5bc8fe7`: +5 migrations; +18 column grants (export format/complete to
`app_user`; Plaid history column; id/household_id reads for retention and verifier roles;
custody `state` UPDATE to `app_user`); +4 table DELETE grants (retention worker on members,
entitlements, idempotency keys; Plaid runtime on accounts); +2 idempotency retention policies;
+3 triggers; 2 new and 7 changed invoker function bodies, every one pinning `pg_temp` last.
No role, membership, schema CREATE, SECURITY DEFINER or BYPASSRLS change; 44 invoker guards.

**Mutations: 16/16 detected, but none at this candidate.** 10 ran on the dirty baseline
worktree (`1dc268d`), 3 on dirty intermediate worktrees (`c81c570`, `535e0b3`), and 3 on a clean
`9f866d7`. Rerunning at `fb6bd05` was impossible because PostgreSQL could not start (see
Environment note). **Correction:** the previous receipt attributed its 10/10 mutations to
`5bc8fe7`, but the run records show a dirty `1dc268d` worktree.

`candidate.json` was written from the clean-tree per-step records after the harness failed to
restart the cluster *after* the last step. The first attempt (`522bf87`) failed correctly on the
guard-inventory pin (43 vs 44) and is retained.

Browser: the export/deletion flows and the dark-mode audit were checked in Chromium on
earlier trees of these features (`10a655a`–`535e0b3`). The Plaid settings screen and the
document drawer control were not browser-tested.

## Requirement matrix

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Local build/type/lint/unit/controls/guards | PASS | Candidate `fb6bd05` |
| Restricted-role DB/HTTP integration, posture | PASS | 862 tests; posture diff above |
| Real-scanner document proof | PASS (local) | 1/1, pinned ClamAV |
| Guard mutation detection | PARTIAL | 16/16, not at candidate |
| User export (originals + JSONL + manifest) | PASS (local synthetic) | Hosted storage/KMS/retention absent; identifiers omitted |
| User deletion request/undo/status | PASS (local) | Final receipt disabled; provider/backup erasure unverified |
| Journal retirement | NOT IMPLEMENTED | Blocked by ADR-019 |
| ADR-019 independent authority | NOT IMPLEMENTED | Needs external authority/provider/approval |
| Plaid suspension race | PASS (local) | Both orders tested |
| Plaid history after unlink | PASS (local) | Default needs PRD §21 |
| Plaid consent/reconnect/disconnect | PASS (local tests) | No Link token flow, no browser pass |
| Plaid operational KMS custody | NOT IMPLEMENTED | Seam only; schema amendment needed |
| Plaid Sandbox provider lifecycle | BLOCKED (external) | No authorization |
| Document cancellation | PASS (local) | No browser pass |
| Old-period resolution | BLOCKED (decision) | PRD §21 |
| Reminder / billing-grace screens | NOT IMPLEMENTED | |
| MFA/recovery browser lifecycle | NOT VERIFIED | |
| Screen reader / Safari / Firefox | NOT VERIFIED | |
| Stripe TEST provider lifecycle | BLOCKED (external) | |
| PG17 staging preflight/migration | BLOCKED (external) | No PG17 download or staging authorization |
| Hosted exact-SHA acceptance | BLOCKED (external) | No push/deploy authorization |
| Supabase 504 / credential containment | OPEN | Packet NOT SENT |
| Legal operator, ToS/privacy, DPAs | OPEN (external) | |
| External security review, on-call, backup/restore drills | OPEN (external) | |

**Decision: NO-GO.** Neither CONDITIONAL GO nor TECHNICALLY READY applies: engineering gates
(ADR-019 authority, operational KMS, journal retirement, MFA/recovery and a11y verification)
are unmet, independent of the external approvals.

## Next order

1. Reboot or have the operator raise `kern.sysv.shmall`, restart the three stopped clusters
   (commands in the session summary), then rerun `plaid-mutations.py` at the candidate.
2. MFA/recovery browser lifecycle (extend the local issuer), browser pass of the Plaid
   settings and document drawer, then screen-reader and Safari/Firefox passes.
3. Reminder and billing-grace screens; an account-level surface for a fenced household's
   deletion status.
4. With authorization: PG17 staging preflight/migration, exact-SHA hosted acceptance,
   Stripe TEST and Plaid Sandbox lifecycles, KMS key/IAM and envelope-v2 amendment.
5. External: ADR-019 authority selection and approval, PRD §21 decisions (Plaid default,
   pending/retained limits, old-period reuse), Supabase packet submission, legal/operator,
   security review, incident response, backup/restore drills.

## Environment note

The host's SysV shared-memory budget (`kern.sysv.shmall` 1024 pages) refused further
`initdb` runs. The harness now keeps one evidence cluster and resets it in place (drop the
database and every non-bootstrap role, recreate the database). That matches initdb's
empty-database/no-application-role state, but not its cluster-level settings. The ClamAV proof
runs on that same cluster after it is moved to the proof's allowlisted endpoint; the
allowlist was not changed. Three stale local clusters from earlier sessions (55540, 55541,
55548) were stopped, not deleted, and could not be restarted: the kernel refuses new SysV segments until reboot. Their data directories are untouched. My QA stack was stopped. Two
orphaned zero-attachment segments whose creator processes were dead were removed with `ipcrm`.
No system setting was changed.

Receipt: [evidence/continuation-privacy-20260924.json](evidence/continuation-privacy-20260924.json).
