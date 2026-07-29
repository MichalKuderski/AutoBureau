# 08 — Notification Service

Reminders are the product's heartbeat — the entire value proposition fails silently if deliverability fails. Treated accordingly.

## 1. Channels

| Channel | Provider | v1 |
|---|---|---|
| Email | Resend + react-email templates (in `packages/ui/emails`) | ✅ primary |
| Web Push | VAPID Web Push (PWA service worker) | ✅ |
| In-app | `notifications` table + SSE badge updates | ✅ |
| SMS | Twilio | deferred (cost + 10DLC registration); the schema already carries the channel enum |
| Calendar | ICS attachments on reminder emails + Google Calendar OAuth | ✅ (ICS) / fast-follow (OAuth) |

## 2. Flow

```
domain event (e.g. reminder.due, approval.requested)
  → notification-composer (worker): policy check → notifications row
  → per-channel fan-out honoring preferences + quiet hours
  → notification_deliveries rows (queued)
  → channel senders (Resend API / web-push) with per-provider rate limits
  → provider webhooks update delivery status (delivered/bounced/complained)
```

Composer policy = preference matrix ∩ quiet hours ∩ dedupe (same kind+target within window collapses) ∩ criticality override (a T-1d critical obligation ignores quiet hours only if the user opted into "urgent overrides").

## 3. Preference model

- Matrix of `kind × channel` defaults: critical-reminder → email+push, digest → email, review-needed → in-app+push, approval-requested → email+push (approvals are time-sensitive).
- Quiet hours in user's timezone (default 21:00–08:00); non-urgent notifications scheduled to the quiet-hour boundary rather than dropped.
- One-click unsubscribe per kind (RFC 8058 `List-Unsubscribe`) — required for Gmail/Yahoo bulk-sender rules and basic decency. Transactional security notices (login from new device, deletion confirmation) are not suppressible.

## 4. The weekly digest

Radar output → one email: "3 things need attention, 2 things handled themselves, 1 thing to know." The digest is the retention surface; it must render usefully even when empty ("nothing due in the next 30 days — here's what's on the horizon"). Digest day/time per household, default Sunday 17:00 local.

## 5. Deliverability engineering

- Separate sending domains: `mail.autobureau.com` (transactional) vs `news.autobureau.com` (future marketing) — reputations never mix.
- SPF, DKIM, DMARC `p=quarantine`→`p=reject` ramp; BIMI later.
- Warm-up plan for send volume; bounce/complaint webhook processing → automatic suppression list (`deliveries.status='suppressed'`); complaint rate alarm at 0.1%.
- Every reminder email contains the obligation deep link + ICS attachment; users who never open email still get value via calendar.

## 6. Testing & preview

react-email preview server in dev; snapshot tests for every template × locale; a `sandbox` Resend key in staging routes all mail to a Mailpit-style trap — staging can never email a real user (doc 09 §4).
