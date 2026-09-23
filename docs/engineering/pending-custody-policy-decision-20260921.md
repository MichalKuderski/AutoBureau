# Pending custody: local mechanics and hosted product decision

Local status only; no customer retention promise or hosted activation.

| Concern | Current local contract | Still required before hosted use |
| --- | --- | --- |
| Admission | 20 retained objects, 500 MiB, 25 MiB/object; includes held/cancelled/completed objects until absence | Founder-ratified pending/retained count and bytes independent of 10/50 processed tier allowances |
| Deadline | Immutable 35-day review timestamp; expiry holds processing, never deletes | Customer deadline, advance warning cadence and delivery failure policy |
| Eligibility | DB UTC month, effective catalog/revision, live custody and available processing slot | Hosted scheduler, workload/cost/archival capacity evidence |
| Ambiguity | Started work never automatically reruns; immutable results retained | Bounded operator/user reconciliation, especially old-period completed work |
| Cancellation | Internal pending/custody cancellation stops new claims and keeps bytes/accounting | Owner-bound UI/API, cancellation-vs-inflight settlement and independently observed cleanup |
| Export | Closed work states and review timestamp in partial v2; originals/identifiers omitted | Reviewed bounded original builder and opt-in identifier reveal |
| Deletion | Fence stops publication; exact local byte unlink has independent local absence readback; journals inventoried | Quota-preserving journal/content retirement and independent ADR-019 authority/provider/backup evidence |
| Abandonment | Held work occupies bounded admission; no silent expiry or infinite processing retry | Founder-approved retain/export/delete outcome and notification/recovery path |

Smallest founder product decision needed before hosted intake: choose the maximum
pending/retained count and bytes, customer retention deadline, warning schedule, and
the explicit outcome when the owner takes no action (including failed notices and
access/export recovery). This decision must enter PRD §21. Do not label these local
engineering limits as Free/Premium policy or silently use automatic deletion to stay
within infrastructure cost. The provisional 10/50 processing allowances and $12/$99
pricing are unchanged. This decision does not block remaining local durability,
privacy, quota UI, Plaid or synthetic validation work.
