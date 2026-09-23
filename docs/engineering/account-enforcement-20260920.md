# Local account enforcement increment — September 20, 2026

Development only; no route/provider/deployment activation. The shared sensitive
operation inventory covers deletion, exports, factor removal, billing, financial
link/unlink and identifier reveal. Each invocation verifies a signed token, current
owner/active-account/deletion-fence/MFA policy, same-user provider factors and recent
password or AAL2/TOTP. Admission repeats after provider I/O. No cached ticket grants
a subsequent mutation: committing domain transactions still recheck owner/fence.
This is not yet whole-application MFA coverage. Enrollment/challenge remain distinct
bootstrap operations so a required-but-not-enrolled account can acquire a factor.
No provider session-revocation claim follows from local JWT verification.

Recovery now has concrete restricted-DB admission/audit and durable fixed limiter
ports. It re-reads factors immediately before password change and fails closed if
the selected factor disappeared or another factor appeared. Required-MFA households
also need recent signed TOTP at commit admission. The ingress IP contract remains a
hosted activation gate; missing trusted IP refuses. Lost-factor reset stays absent.
Provider operations remain single-attempt and ambiguous results never auto-retry.

Password policy pins zxcvbn 4.4.2, score >=3, 8–128 exact characters with control
characters refused to bound synchronous work. No composition requirement. The
[HIBP range protocol](https://haveibeenpwned.com/API/v3#PwnedPasswords) sends only five
SHA-1 prefix characters, requests padding and compares suffixes locally. Fixed HTTPS
endpoint, no redirects/cookies/referrer, three-second deadline and bounded decoded
body/chunks. Malformed/duplicate/oversized/unknown replies and outages refuse; no
password is sent to Auth until policy succeeds. No live HIBP calls were made.
The [estimator](https://github.com/dropbox/zxcvbn) runs server-side only.
Prefix disclosure still allows dictionary inference; tests prove the wire excludes
the password/full hash/suffix, not that a weak password is unreconstructable.
Neither password nor hash may enter logs, traces or telemetry. Hosted transport
instrumentation must preserve that prohibition before activation.

Supabase: three historical gateway 504s confirmed, deeper hop unknown; historical
management-token invalidation unproven. Support packet PREPARED BUT UNSENT.
ADR-019 remains APPROVE WITH REQUIRED AMENDMENTS, nonoperational. No journal
retirement/final deletion receipts. All Production/live/real-data/rollout gates closed.

Targeted development evidence is under `/private/tmp/pellum-account-enforcement-20260920`.
Final candidate verification will supersede these targeted runs; this file makes no
full-stack, staging or release-readiness claim.
