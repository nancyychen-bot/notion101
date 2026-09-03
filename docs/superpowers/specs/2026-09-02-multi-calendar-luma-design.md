# Multi-Calendar Luma Support — Design

**Date:** 2026-09-02
**Status:** Approved, pending implementation plan

## Problem

Notion 101 is hard-wired to a single Luma calendar via `LUMA_API_KEY` /
`LUMA_WEBHOOK_SECRET`. Many organizers run events on **their own** Luma
calendars, and Luma issues **API keys per calendar** — there is no org-wide key.
Supporting N calendars means storing N `(api_key, webhook_secret)` pairs and
routing every inbound/outbound call to the right one.

**Mental model:** every event is owned by exactly one calendar. Resolve the owner
**once**, tag the event with a calendar id (`events.luma_calendar`), and all
later calls look up credentials by that tag. Ownership is decided by the
provider (a Luma key can only read its own calendar's events), never by
string-matching names.

This ports the pattern proven in the `office-hours` project
(`docs/multi-calendar-support.md`), adapted to this repo's stack.

## Key divergence from the reference implementation

`office-hours` stores the registry in **Supabase**, using RLS deny-all +
service-role as the entire security model for the secret keys. Notion 101 uses
**Neon Postgres** via `DATABASE_URL`, with schema kept in `lib/db/schema.sql`
(idempotent `create table if not exists`). Neon has no RLS/service-role split —
the whole database is already reachable only with `DATABASE_URL` (server-only),
the same posture as the existing `guests` table. So the `luma_calendars` table
carries its secrets as a plain table with **no RLS ceremony**. That is a
deliberate simplification, not an omission.

## Decisions (confirmed)

- **Entry points:** both a standalone `/add-calendar` page (bulk pre-register
  regions) and a just-in-time reveal inside `/add-event`.
- **Schema apply:** append to `lib/db/schema.sql` as idempotent statements,
  matching the existing pattern; applied against Neon the same way `schema.sql`
  is applied today. No migration runner introduced.
- **Env fallback:** keep DB-merged-over-env. Existing `LUMA_API_KEY` /
  `LUMA_WEBHOOK_SECRET` seed a `'default'` calendar; DB rows override by id. No
  flag day — ship the table, add rows, verify, optionally drop env vars later.
  Existing tracked events (with `luma_calendar` null) keep syncing via
  `'default'`.
- **Registry columns:** full parity — `id, api_key, webhook_secret,
  calendar_id, city, calendar_url`.
- **`/add-calendar` gating:** same form-token + public posture as `/add-event`
  (self-service onboarding by organizers who have no dashboard session; the form
  is write-only and the form-token blocks drive-by bots).

## Section 1 — Data layer

### `lib/db/schema.sql` (append, idempotent)

```sql
create table if not exists luma_calendars (
  id             text primary key,          -- slug; also stored on events.luma_calendar
  api_key        text not null,
  webhook_secret text,
  calendar_id    text,                       -- Luma 'cal-…' id, for dedupe
  city           text,
  calendar_url   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists luma_calendars_calendar_id_idx on luma_calendars(calendar_id);

alter table events add column if not exists luma_calendar text;  -- null = 'default'
```

### `lib/db/luma-calendars.ts` (new — the only module that touches the table)

Uses the existing `sql` tagged-template client from `lib/db/client.ts`.

```ts
export interface LumaCalendarRow {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
  calendarId: string | null;
  city: string | null;
  calendarUrl: string | null;
}

export function mapCalendarRow(row): LumaCalendarRow           // snake→camel, pure, unit-tested
export async function listLumaCalendarRows(): Promise<LumaCalendarRow[]>          // throws on DB error
export async function upsertLumaCalendar(row: LumaCalendarRow): Promise<void>     // on conflict (id) do update
export async function getLumaCalendarByCalendarId(calendarId: string): Promise<LumaCalendarRow | null>
```

`listLumaCalendarRows` throws on DB error so callers decide fail-open vs
fail-loud.

## Section 2 — Credential/routing module (`lib/luma/calendars.ts`, new)

The single chokepoint for keys/secrets/urls. Swapping the source (env → DB)
touches only this file plus adding `await` at call sites.

```ts
export interface LumaCalendar { id: string; apiKey: string; webhookSecret: string | null }

export async function lumaCalendars(): Promise<LumaCalendar[]>              // env keyring ∪ DB; DB wins by id
export async function apiKeyForCalendar(id: string | null | undefined): Promise<string>  // null/empty → 'default'; throws if unknown
export async function calendarUrlForCalendar(id: string | null | undefined): Promise<string | null>
export async function lumaWebhookSecrets(): Promise<string[]>              // inbound verify pool
export function __bustCalendarCache(): void
```

Behavior (from the reference doc):

- **(a) DB merged over env, DB wins.** Read both; env-defined `'default'`
  calendar (seeded from `LUMA_API_KEY` / `LUMA_WEBHOOK_SECRET` /
  `LUMA_CALENDAR_URL` if present) stays working, DB rows override on id
  conflict. No flag day.
- **(b) ~60s in-memory cache.** `lumaWebhookSecrets()` runs on every inbound
  webhook and `lumaCalendars()` on every resolve. Cache the loaded set for 60s.
  `__bustCalendarCache()` is called right after any write so the writing request
  sees its own change; accept ≤60s staleness on other serverless instances
  (self-heals on retry + TTL).
- **(c) Fail-open on DB error.** If the DB read throws, fall back to env-only
  rather than returning an empty set — an empty set would make every event look
  unconnected and reject every inbound webhook.

## Section 3 — Luma client changes (`lib/luma/client.ts`)

The invasive part (async ripple). Every outbound function currently hardcodes
`env.luma.apiKey()`; each gains an `apiKey` parameter:

- `getLumaEvent(eventId, apiKey)`
- `listEventGuests(eventId, apiKey)`
- `fetchEventStats(eventId, apiKey)`
- `updateGuestStatus({ …, apiKey })`

New functions:

- `listUpcomingCalendarEvents(apiKey) → { id, url, calendarId, city }[]` —
  `GET /v1/calendars/events/list?after=<now>`, cursor-paginated (50/page).
  (Confirm the exact path/response shape against `office-hours/lib/luma/client.ts`
  during implementation.)
  Filtering by `after=<now>` keeps resolution to a page or two on busy
  calendars.
- `cityFromGeo(geo) → string | null` — `city ?? city_state.split(",")[0]`
  (international-city fix: Luma leaves structured `city` null for many non-US
  addresses).

Changed:

- `resolveLumaEventId(input)` — for a vanity URL, match its slug against each
  connected calendar's upcoming events via the **authenticated** API
  (Cloudflare-proof), instead of the current datacenter-IP HTML fetch that
  Cloudflare challenges. The HTML scrape remains only as a last-resort fallback
  for the no-calendars case. Resolution also yields the owning calendar id.

Call sites to update (each first resolves `apiKeyForCalendar(event.luma_calendar)`):
`lib/events/register.ts`, `lib/events/apply-status.ts`,
`app/api/webhooks/luma/route.ts`, `app/api/webhooks/notion/route.ts`,
`scripts/register-event.ts`, and any `fetchEventStats` caller. The type system
surfaces the complete list.

## Section 4 — Inbound webhook (`app/api/webhooks/luma/route.ts`)

One endpoint, fan-in by secret. Fetch `lumaWebhookSecrets()`, verify the raw
body against the **pool** via a new `verifyAnyLumaSignature()` in
`lib/luma/verify.ts` (keep the existing single-secret `verifyLumaSignature`).
Route by the globally-unique `luma_event_id`, not by which secret matched. The
existing "skip events not in our DB" gate is unchanged.

**Gotcha preserved:** verification is enforced whenever *any* calendar has a
secret, so a calendar's secret must be stored **before** its webhook is enabled
in Luma, or it will 401. This is why webhook secret is required at onboarding.

Outbound status pushes use `apiKeyForCalendar(event.luma_calendar)`.

## Section 5 — Onboarding, routes, pages

### `lib/events/onboard.ts` (new)

- `resolveNewCalendarEvent({ lumaEvent, apiKey })` — validate a pasted key
  **against that exact event**: list the key's upcoming events, match by id or
  vanity slug. Returns `{ eventId, calendarId, city }`. Proves the key is
  correct and yields the calendar id + city.
- `connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city? })` —
  validate-before-store (the list call doubles as validation; an empty list from
  a valid key is still OK), derive `cal-…` id from `calendarUrl` or first event,
  dedupe by `calendar_id` (reuse existing row's id), upsert, bust cache.
- `deriveCalendarId(...parts)` — normalize each candidate **before** falling
  through so an empty-normalizing slug doesn't beat a usable city and produce an
  empty primary key. Always non-empty (defaults to `'calendar'`).
- `CalendarNotConnectedError` (thrown from `register.ts`) drives the JIT reveal.

`registerEventFromLuma` gains: resolve the owning calendar, write
`events.luma_calendar` **once**, never re-resolve afterward.

### API routes (top-level convention, form-token protected)

- `app/api/add-event/route.ts` — extend: if resolution finds no connected
  calendar and no key was supplied → `{ ok:false, needsCalendar:true }`; if a
  key is supplied, `resolveNewCalendarEvent` → upsert calendar → register.
- `app/api/add-calendar/route.ts` — new: `connectCalendar`, fail-loud on a key
  Luma rejects.

### Pages (form-token, public, iframe-embeddable — like `/add-event`)

- `app/add-event/page.tsx` + form component — add the conditional
  key/secret/url/slug reveal when the API returns `needsCalendar:true` (amber
  callout, resubmit).
- `app/add-calendar/page.tsx` + new form component — fields: slug, apiKey,
  webhookSecret, calendarUrl, city (optional). Success shows the resolved
  calendar id + city.
- `middleware.ts` — add `/add-calendar` to the public exclusion list alongside
  `/add-event`.

## Section 6 — Testing

Unit tests (Vitest, matching existing `tests/`):

- `mapCalendarRow` — snake→camel mapping
- `deriveCalendarId` — normalize-before-fallback, empty/non-ASCII slugs, always
  non-empty
- `lib/luma/calendars.ts` — env∪DB merge (DB wins), 60s cache + bust, fail-open
  on DB error (mock `listLumaCalendarRows` to throw)
- `cityFromGeo` — US (structured city), international (`city_state` fallback),
  null
- `verifyAnyLumaSignature` — matches on any pooled secret, rejects when none
  match, empty pool

## Known limitations / out of scope

- **QUESTION_MAP scope.** `lib/notion/QUESTION_MAP.json` maps this one Notion
  database's registration `question_id`s. Events on *other* calendars may use
  different question IDs, so their answer-columns could be blank until the map
  is extended. Pre-existing concern, unchanged by this work.
- **No key encryption.** Neon's server-only posture makes envelope encryption
  unnecessary; add only if a ciphertext-only DB dump leaking is a real
  requirement.
- **No Slack routing** (office-hours has it; Notion 101 does not).
- **Add-only.** No UI for editing/removing calendars in this pass.

## Reference

- Porting guide: `office-hours/docs/multi-calendar-support.md`
- Reference impl: `office-hours` — `migrations/0050_luma_calendars.sql`,
  `lib/db/luma-calendars.ts`, `lib/luma/calendars.ts`, `lib/luma/client.ts`,
  `lib/events/onboard.ts`, `app/api/hub/add-event/route.ts`,
  `app/api/hub/add-calendar/route.ts`, `app/api/webhooks/luma/route.ts`,
  `components/hub/AddEventForm.tsx`, `components/hub/AddCalendarForm.tsx`
