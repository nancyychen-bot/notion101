# Notion 101 — Luma ⇄ Notion Sync + Comms

**Date:** 2026-08-24
**Status:** Approved design (pre-implementation)
**Reference project:** `office-hours` (Notion Build Bar Hub) — reuse patterns, strip complexity.

## 1. Summary

A Next.js app on Vercel that links a single **Notion guest database** to a **Luma
event's guest list**. Organizers approve/decline guests in Notion; those decisions
push to Luma. The system sends automatic transactional emails and auto-declines
stragglers the day before the event.

This is a **much simpler** cousin of Build Bar:
- **No** two-workspace hub, **no** Ambassador platform, **no** 1:1 slot bookings, **no** Slack.
- **One** Notion database (guests). **One** Luma event guest list per registered event.
- Events are opt-in via a registration ("signup") page, so the DB only ever tracks
  **Notion 101 events**.

## 2. Architecture

```
   Luma (Notion 101 event)  ──webhook──▶  App (Next.js on Vercel)  ──create/update──▶  Notion guest DB
   RSVP + check-in                        Neon Postgres (mirror + audit)              (human triage)
                                                        ▲                                    │
                                          approve/decline via update-guest-status ◀──webhook─┘
                                          + Resend emails (approve/decline/reminders/survey)
```

- **Human triage surface:** the Notion guest database.
- **Source of RSVP truth:** Luma. **Mirror/dedup/audit:** Neon Postgres.
- **Scoping gate:** only Luma events registered through the signup page are processed;
  the Luma webhook drops guests for any unregistered event.
- **Loop prevention:** every outbound Notion write stamps `guests.last_synced_hash`;
  echo webhooks matching that hash are dropped.

## 3. Stack

- **Next.js 14 App Router** (Node.js runtime, Fluid Compute) on Vercel.
- **Neon Postgres** via the Vercel Marketplace integration (`DATABASE_URL` injected).
  Query layer: `@neondatabase/serverless` (or `postgres`). No ORM.
- **Notion API** (`@notionhq/client`, data-source API v2025-09-03+).
- **Luma public API** (`https://public-api.luma.com`, `x-luma-api-key` header).
- **Resend** for email.
- **Vitest** for unit tests.

## 4. Data model (Neon Postgres)

`events`
- `id` uuid pk
- `luma_event_id` text unique not null (`evt-…`)
- `name` text
- `start_at` timestamptz, `end_at` timestamptz, `timezone` text
- `public_url` text
- `survey_url` text null (per-event override; else falls back to env `SURVEY_URL`)
- `created_at` timestamptz default now()

`guests`
- `id` uuid pk
- `event_id` uuid fk → events
- `luma_guest_id` text unique not null (`gst-…`)
- `name` text, `email` text
- `luma_status` text — one of `pending | approved | declined | waitlist`
- `checked_in_at` timestamptz null (from Luma check-in; gates the survey)
- `notion_page_id` text null
- `last_synced_hash` text null (echo guard)
- `created_at`, `updated_at` timestamptz

`email_log` (dedup + audit)
- `id` uuid pk
- `guest_id` uuid fk → guests
- `kind` text — `approved | decline | reminder_3d | reminder_1d | survey`
- `recipient_email` text
- `resend_id` text null
- `status` text — `sent | failed | skipped`
- `created_at` timestamptz
- **unique** `(guest_id, kind, recipient_email)` — the idempotency key.

`sync_log` (audit)
- `id`, `direction` (`luma_in | notion_in | cron`), `action`, `result`
  (`applied | error | skipped_echo`), `guest_id` null, `note`, `payload` jsonb, `created_at`.

## 5. Notion guest database

Created by a one-time setup script (`scripts/create-notion-database.ts`). Properties:
- **Name** (title)
- **Email** (email)
- **Status** (select: `Pending`, `Approved`, `Declined`, `Waitlist`) — the triage control
- **Event** (text — event name; simple, no relation needed)
- **Registered At** (date)
- **Company**, **Role** (rich text, optional — populated if present on the Luma RSVP)
- **Luma Guest ID**, **Luma Event ID** (rich text, hidden — join keys)

Approve/decline = change **Status**, or two buttons ("Approve"/"Decline") that set Status
and fire the Notion "Send webhook" automation with an `X-Action` header.

## 6. Flows

### 6.1 Event registration (signup page) — `/add-event`
Embeddable in a Notion page (no `X-Frame-Options`; `frame-ancestors` CSP allows Notion).
Paste a Luma event link → resolve `evt-…` → fetch event detail → insert into `events`.
Then **backfill**: pull the full Luma guest list, upsert into `guests`, and create Notion
rows for each. Protected by a short-lived form token (reuse Build Bar's `issueFormToken`).

### 6.2 Luma → Notion — `POST /api/webhooks/luma`
1. HMAC-verify the payload (`LUMA_WEBHOOK_SECRET`); reuse `lib/luma/verify.ts`.
2. Parse `guest.created` / `guest.updated` (name, email, `approval_status`, `checked_in_at`).
3. **If the event isn't registered → log `skipped` and return 200.**
4. Upsert the guest in Neon (including `checked_in_at`).
5. Create/update the Notion row; stamp `last_synced_hash`.

### 6.3 Notion → Luma (approve/decline) — `POST /api/webhooks/notion`
Notion "Send webhook" automation on Status change / Approve/Decline button.
1. Verify shared secret (header or body).
2. Ack immediately; do the work in `after()` (Fluid Compute keeps the fn alive).
3. Fetch the page (authoritative), resolve the guest by `notion_page_id`.
4. **Echo guard** — drop if the incoming state matches `last_synced_hash`.
5. Map Status → Luma status; call `updateGuestStatus` (`update-guest-status`):
   - **approved:** `send_email: false` (we send our own custom approval email).
   - **declined:** `send_email: false` (we send the decline email).
   - **waitlist / pending:** `send_email: false`.
6. Send the corresponding Resend email (see §7), mirror final status back to Notion.

### 6.4 Automatic emails (Resend) — see §7.

### 6.5 Day-before auto-decline — `POST /api/cron/decline-pending` (daily)
For events happening **tomorrow**, decline every still-`pending` guest → Luma
(`declined`, `send_email:false`) → decline email → Notion mirror. Best-effort per guest.
Adapted from `lib/events/decline-pending.ts`.

## 7. Emails

Reuse Build Bar's send + dedup infra (`lib/email/resend.ts`, `comms.ts`, `templates.ts`,
`ics.ts`). Sender from `COMMS_FROM`; kill-switch `COMMS_ENABLED`; each send idempotent
via `email_log` unique key.

| Kind | Trigger | Recipient | Notes |
|------|---------|-----------|-------|
| `approved` | Guest approved in Notion | Guest | Custom branded confirmation; **.ics event invite attached**. Suppresses Luma's native email. |
| `decline` | Guest declined (manual or auto) | Guest | Polite decline. |
| `reminder_3d` | Cron, 3 days before event | Approved guests | Event details + **"start your free Notion trial" CTA** (`FREE_TRIAL_URL`). |
| `reminder_1d` | Cron, 1 day before event | Approved guests | Same body/CTA as 3d, different framing. |
| `survey` | Cron, a few hours after event ends | **Checked-in guests only** | Fixed `SURVEY_URL` (or per-event `events.survey_url`). |

## 8. Crons (`vercel.json`)

| Path | Schedule (UTC) | Purpose |
|------|----------------|---------|
| `/api/cron/decline-pending` | `0 13 * * *` | Day-before auto-decline of pending. |
| `/api/cron/reminders` | `0 15 * * *` | Handles both 3-day and 1-day windows in one pass. |
| `/api/cron/survey` | `0 * * * *` | Sends survey to checked-in guests of events that ended a few hours ago. |
| `/api/cron/comms-retry` | `*/15 * * * *` | Retry `failed` email_log rows. |
| `/api/cron/reconcile` | `0 * * * *` | Re-poll Luma guest lists for registered upcoming events to catch missed webhooks (status + check-in). |

All cron routes authenticate via `CRON_SECRET` (header or bearer), GET+POST accepted.

## 9. Minimal dashboard

Password-protected (`DASHBOARD_PASSWORD` + signed session cookie; reuse Build Bar's
`lib/auth`). Routes:
- `/` — registered events with guest counts by status; recent email_log; recent sync_log.
- `/add-event` — the signup page (§6.1).
- Buttons: **Sync now** (re-run reconcile for an event) and **Send reminder now** (manual reminder trigger).

## 10. Environment variables

```
DATABASE_URL                     # Neon (injected by Vercel integration)
LUMA_API_KEY
LUMA_WEBHOOK_SECRET
NOTION_TOKEN
NOTION_GUESTS_DATA_SOURCE_ID
NOTION_GUESTS_DB_ID              # optional (for links)
NOTION_WEBHOOK_SECRET
RESEND_API_KEY
COMMS_FROM                       # e.g. "Notion 101 <noreply@notioncommunity.com>"
COMMS_REPLY_TO                   # optional
COMMS_ENABLED                    # optional kill-switch (default true)
CRON_SECRET
DASHBOARD_PASSWORD
SESSION_SECRET
SURVEY_URL                       # fixed post-event survey link
FREE_TRIAL_URL                   # Notion free-trial CTA in reminders
APP_BASE_URL
```

## 11. Testing (Vitest)

- Echo-hash: identical field set → echo; changed field → not echo.
- Luma verify (HMAC) + parse (guest.created/updated → normalized guest incl. check-in).
- Email template render: subject/html/text non-empty for each kind; CTA/survey links present.
- `selectDeclinablePendings`: only `pending` selected.
- Reminder window selection: event 3 or 1 days out selected; others not.
- Survey audience: only guests with `checked_in_at` selected.

## 12. Reuse map (from `office-hours`)

- `lib/luma/client.ts` — `resolveLumaEventId`, `getLumaEvent`, `listEventGuests`,
  `fetchEventStats`, `updateGuestStatus` (approve/decline mechanism). Reuse ~as-is.
- `lib/luma/verify.ts`, `lib/luma/parse.ts` — HMAC + payload normalize (trim to our fields).
- `lib/email/*` — Resend send, ics, templates, comms dedup orchestration.
- `lib/events/decline-pending.ts` — day-before decline (drop the slot/booking bits).
- `lib/events/register.ts` + `app/add-event` + `lib/auth/form-token` — event signup page.
- `lib/auth/*` — dashboard password/session.
- Replace all Supabase data access (`lib/db/*`, `lib/supabase/*`) with a Neon query layer.

## 13. Out of scope (YAGNI)

1:1 slots/matching, Ambassador/second workspace, Slack, expert feedback, calendar
holds beyond the single approval .ics, manual broadcast composer.

## 14. Open items for setup (external input)

Luma Plus + API key & webhook secret · Notion integration token + guest DB (script creates
schema) · Resend API key + verified sender domain · Neon project (Vercel integration) ·
`SURVEY_URL` + `FREE_TRIAL_URL` · Vercel project.
