# Supabase support packet — prepared, NOT SENT

Staging project: `kdqnfruwgocfqwpbpuxo` (Supabase region us-west-2).
Affected date: September 13, 2026, UTC. Synthetic acceptance requests from Vercel
Preview against the staging backend. No Production project is involved.

We need provider-side correlation to determine which component produced these
gateway HTTP 504 responses and why. Application responses were coarse HTTP 503.

| UTC gateway timestamp | Route | Provider request ID | Gateway log ID | HTTP | Raw origin_time |
| --- | --- | --- | --- | --- | --- |
| 2026-09-13 15:25:06.508000 | POST /auth/v1/signup | `01a09b5f-4286-7db1-9262-9c4232ad2668` | `42aac198-23e9-4fb8-8954-7d266864ea96` | 504 | 5150 |
| 2026-09-13 15:40:08.450000 | POST /auth/v1/token | `01a09b6d-05f9-73ec-8567-515c9d9a5b9f` | `786fcd07-4445-4422-b801-dbf75b480639` | 504 | 5154 |
| 2026-09-13 22:25:08.490000 | POST /auth/v1/token | `01a09cdf-cf92-7e3b-a9cc-e59dfdd0a8fa` | `49a643b3-1fbe-44a4-8ac7-17f29c162775` | 504 | 5016 |

Corresponding application response timestamps: 15:25:11.719Z, 15:40:13.659Z and
22:25:13.540Z. For the last occurrence, the application received upstream HTTP 504
after **5,030 ms**, before its own **10,000 ms** deadline, with one provider attempt.
The raw gateway origin_time units/configured threshold have not been independently
verified. No automatic credential retry was performed.

Read-only ClickHouse `logs` queries on September 20 recovered all three gateway
records. An exact request-ID match against `auth_logs` in September 13
15:20–22:30 UTC returned zero. Auth logs for other requests are present. The same
wide window contains 40 PostgreSQL LOG-level and 94 Supavisor info-level rows;
these do not establish the absence of historical pressure. Later successful
requests are not treated as root-cause evidence.

Please correlate these exact IDs with gateway upstream connection/read timing,
Auth service request/service-health traces, and any corresponding database wait,
resource or dependency failure evidence. Can you identify the timeout-producing
hop, confirm the origin_time units, and provide a supported cause and remediation?

No credentials, OAuth callbacks, users, emails, request bodies, provider headers,
tokens, financial data or document data are included. External submission requires
the owner's explicit authorization.
