# Pellum local live preview and Sites registration

Registered September 20, 2026 at the user's request to see the project while it is
being developed. This is navigation/preview setup, not a release or hosting migration.

- Sites title: **Pellum — Development**
- Exact project ID: `appgprj_6ab08a756e108191acf56abf72893c7e`
- Binding: `.openai/hosting.json` in this existing review worktree.
- Readback: owner-only custom access, no external visitors, zero saved versions,
  no live deployment. Reuse this ID; do not create a replacement Site.
- Source: `/private/tmp/pellum-native-review-20260920`, branch
  `codex/review-pellum-hardening-v2`.
- Local preview: `http://127.0.0.1:4317/` (this Mac only).

The Next development server reads this worktree and supports live reload while it
is running. The initial homepage returned 200 and rendered Pellum's title. Codex's
browser-panel open request was queued for this task. The process is intentionally
left running for the requested live view; it is not an always-on hosted service and
may need restarting after the task/runtime or computer restarts.

The preview starts with a minimal environment and no provider credentials. No auth
bypass is installed. Public pages render; authenticated routes and database-backed
actions remain unavailable until an isolated local test backend is configured.
Do not connect this development view to Production or expose real household data.

To restart with the same existing pinned toolchain, run in the review worktree:

```sh
env -i HOME="$HOME" PATH="/private/tmp/pellum-v2-review-20260920/bin:/private/tmp/pellum-v2-review-20260920/node-v22.16.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin" NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 pnpm --filter @autobureau/web exec next dev --hostname 127.0.0.1 --port 4317
```

First inspect any subsequently added `.env*` files without printing their values;
Next loads applicable files even when its inherited environment is cleared. Do not
kill another service if port 4317 is already owned; reuse this preview when healthy.

Sites registration does not upload the repository or turn a local server into a
hosted Site. Native Sites hosting uses Cloudflare Workers; this Next.js/Prisma/Postgres
application has not been ported or verified for that runtime. No source push, saved
Sites version, deployment, DNS change, hosting migration or provider mutation was
performed. The unpublished Sites entry leads back to this development task; use the
local browser URL for the interactive view. Do not describe the entry as a published
or fully functioning hosted application.

Existing Production, live-payment, real-data, document/model-processing and public
launch gates remain closed. Native hosted Sites compatibility and publication are
separate work; preserving the existing architecture takes precedence over replacing
the application with a starter or a disconnected mockup.
