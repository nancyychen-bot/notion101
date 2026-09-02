# Volunteer Feedback — Ambassador→Dev Mirror + Hub

**Date:** 2026-09-02
**Status:** Approved design → pending spec review
**Author:** Claude (Opus 4.8) with Nancy Chen

## 1. Goal

Capture **volunteer** (ambassador / Notino / partner) feedback for the Notion 101 series.
Volunteers submit a Notion form on the **Ambassador prod** workspace that writes to a prod
database; the hub mirrors each response into a **dev** Notion database (building out its
properties), persists it to Neon, and surfaces it on a new `/volunteers` hub page.

This is the volunteer analog of OfficeHours' "expert feedback" mirror. It is **independent**
of the existing guest-feedback feature (separate table, page, importer); it only reuses the
pure helpers `selectEventForFeedback` (event matching) and `eventLabel` (tab labels).

## 2. Source & destination (verified)

Both databases are reachable via the default Notion API (`api.notion.com`) with the classic
(2022-06-28) shape — the notion-101 SDK (`@notionhq/client` ^2.2.15) reads the prod DB and can
build/write the dev DB via `databases.update` / `pages.*` (no v5 dataSources API needed).

- **Ambassador prod — "Notion 101 Volunteer Feedback"** `3ce3139dbfef809bbd60e1e4232e8238`,
  read with **`NOTION_AMBASSADOR_TOKEN`** (new). Its properties (the form schema):
  - `Volunteer name` (title)
  - `Volunteer type` (select: Ambassador · Notino · Event partner · Other volunteer)
  - `City` (select: New York · San Francisco)
  - `Track(s) supported` (multi_select: Brick & Mortar · E-commerce & Online · Services · Combined / General)
  - `Preparedness` (select: `5 — Very prepared` … `1 — Not prepared`)
  - `Overall experience` (select: `5 — Excellent` … `1 — Poor`)
  - `What worked well` (rich_text) · `Challenges` (rich_text) · `Improvements` (rich_text)
  - `Submitted` (created_time)
- **Dev mirror — "Volunteer Feedback Notion 101s"** `3ceb35e6e67f807d9fa4e219f3146462`,
  written with the **existing `NOTION_TOKEN`** (already reaches the dev workspace). Currently
  only a `Name` title — this spec builds its properties.

Ids are pinned as constants, overridable via env `NOTION_VOLUNTEER_PROD_DB_ID` /
`NOTION_VOLUNTEER_DEV_DB_ID`.

## 3. Dev DB property build-out

One-time `scripts/configure-volunteer-feedback-db.ts` (`npm run setup:volunteer-feedback`) sets
the dev DB schema via `databases.update` (classic shape). Properties:

| Property | Type | Notes |
|---|---|---|
| `Volunteer name` | title | rename existing `Name` title |
| `Volunteer type` | select | options seeded to match prod |
| `City` | select | New York, San Francisco |
| `Track(s) supported` | multi_select | 4 track options |
| `Preparedness` | select | 5→1 options |
| `Preparedness score` | number | derived 1–5 |
| `Overall experience` | select | 5→1 options |
| `Experience score` | number | derived 1–5 |
| `What worked well` / `Challenges` / `Improvements` | rich_text | |
| `Submitted` | date | from prod `created_time` |
| `Event` | rich_text | matched Luma event name |
| `Event Date` | date | matched event start |
| `Ambassador page ID` | rich_text | idempotency key (source page id) |

## 4. Reader + score parsing (`lib/notion/volunteer-feedback.ts`)

- `VF` constant of pinned prod property names.
- Pinned prod/dev DB ids (env-overridable).
- `parseScore(label)` — leading integer of a `"5 — Excellent"` label → 5; null otherwise
  (same idea as guest `parseSatisfactionScore`, but em-dash tolerant: `/^\s*(\d+)/`).
- Readers for title/select/multi_select/rich_text.
- `readVolunteerContent(props)` → `{ volunteerName, volunteerType, city, tracks[],
  preparednessLabel, preparednessScore, experienceLabel, experienceScore, whatWorked,
  challenges, improvements }`.
- `fetchVolunteerFeedbackPages()` — paginate the ambassador prod DB (ambassador client);
  returns `{ id, createdTime, props }[]`.
- `buildDevProperties(content, event, submittedAtISO)` — the write payload for a dev page
  (title + selects + multi_select + numbers + rich_text + Event/Event Date + Ambassador page ID).

## 5. Event attribution (`lib/events/volunteer-match.ts` — or reuse)

Volunteers aren't guests, so match by **City + date**: candidate events are those whose
`events.location` (city, from Luma ingestion) equals the response City; choose the most recent
dated **on/before** the Submitted date. This is exactly the shape of the existing pure
`selectEventForFeedback(candidates, submittedAtISO)` — reuse it, passing
`EventCandidate { eventId, guestId: "", eventDate }`. No match → `event_id = null` (kept, counted).

A new DB helper `eventsInCity(city)` returns `{ eventId, eventDate }[]` from Neon
(`select id, to_char(start_at,'YYYY-MM-DD') where lower(location)=lower(city)`).

## 6. Storage — Neon `volunteer_feedback`

```sql
create table if not exists volunteer_feedback (
  ambassador_page_id text primary key,
  dev_page_id        text,
  event_id           uuid references events(id) on delete set null,
  volunteer_name     text,
  volunteer_type     text,
  city               text,
  tracks             text[],
  preparedness_label text,
  preparedness_score int,
  experience_label   text,
  experience_score   int,
  what_worked        text,
  challenges         text,
  improvements       text,
  submitted_at       timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists volunteer_feedback_event_idx on volunteer_feedback(event_id);
```

`dev_page_id` makes the dev-Notion upsert idempotent (update in place vs create). The hub reads
only from Neon (no live Notion reads on page load).

## 7. Import orchestrator (`lib/events/volunteer-feedback-import.ts`)

`importVolunteerFeedback()`:
1. `fetchVolunteerFeedbackPages()` from ambassador prod.
2. Per page: `readVolunteerContent`; match event via `eventsInCity(city)` + `selectEventForFeedback`.
3. Look up existing `dev_page_id` from Neon by `ambassador_page_id`.
4. Write to dev Notion (`buildDevProperties`): update existing dev page, else create under the
   dev DB; capture `dev_page_id`.
5. Upsert the Neon row (content + `event_id` + `dev_page_id`) by `ambassador_page_id`.
6. `logSync({ direction:"cron", result:"applied", action:"volunteer_feedback_import", note })`.
Returns `{ imported, matched, unattributed }`.

## 8. Routes & triggers

- `app/api/cron/volunteer-feedback-import/route.ts` — cron-auth (`isAuthorizedCron`), hourly
  entry in `vercel.json`.
- `app/api/volunteer-feedback-import/route.ts` — session-guarded (same pattern as
  `/api/feedback-import`).
- The global `RefreshButton` fires **both** `/api/feedback-import` and
  `/api/volunteer-feedback-import` in parallel.

## 9. Hub `/volunteers` page

- `AppNav` gains a `Volunteers` link (Dashboard · Feedback · Volunteers · Settings).
- `app/volunteers/page.tsx` (server): loads `listVolunteerFeedback()` + `eventSummaries()`;
  builds event tabs (`eventLabel`).
- `components/VolunteersTable.tsx` (client): event tabs + search + summary line (responses,
  avg Overall experience, avg Preparedness) + table: Volunteer · Type · City · Event · Tracks ·
  Preparedness · Overall · What worked · Challenges · Improvements · Submitted.
- **Middleware:** add `/volunteers` to the matcher (PII — same as `/feedback`).

## 10. Env

- `NOTION_AMBASSADOR_TOKEN` (required for volunteer import; stored in `.env.local`, must be
  added to Vercel prod before the prod cron works).
- `NOTION_VOLUNTEER_PROD_DB_ID`, `NOTION_VOLUNTEER_DEV_DB_ID` (optional overrides; defaults pinned).
- Documented in `.env.example`.

## 11. Testing (vitest, pure)

- `parseScore` incl. em-dash labels and non-numeric → null.
- `readVolunteerContent` maps a full prod props fixture.
- Event matching via `selectEventForFeedback` with city-derived candidates (single, repeat,
  none). (Reused function already has coverage; add a volunteer-flavored case.)
- Mirror/DB layers verified against the real dev DB during implementation (throwaway script,
  cleaned up), not unit-tested.

## 12. Non-goals / YAGNI

- No volunteer cards on the guest dashboard (volunteers are a distinct audience; the
  `/volunteers` page owns them). A small dashboard link is out of scope unless asked.
- No writing back to ambassador prod (read-only source).
- No dedup of volunteers across events beyond the `ambassador_page_id` idempotency key.
