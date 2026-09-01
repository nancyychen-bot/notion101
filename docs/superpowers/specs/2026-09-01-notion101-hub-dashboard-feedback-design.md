# Notion 101 Hub — Dashboard, Event Results & Feedback

**Date:** 2026-09-01
**Status:** Approved design → pending spec review
**Author:** Claude (Opus 4.8) with Nancy Chen

## 1. Goal

Bring the notion-101 app (`notion-101.vercel.app`) up to functional parity with the
"Notion Build Bar Hub" (`office-hours-three.vercel.app`) for the pieces that apply to a
**workshop series**: a rich event-filtered **Dashboard**, a **Feedback** page, and
**feedback ingestion** from the shared Notion feedback database. Email settings already
exist and are reused as-is.

Explicitly **out of scope** (office-hours 1:1 concepts that don't apply to a workshop):
Bookings, Expert Feedback, Top Voluntinos leaderboard, 1:1 coverage, Slack/Backups/Admins
settings sub-pages.

## 2. Series-first requirement

Notion 101 is run as a **global series**: many stops, different cities, different dates.
The design is event-centric so this works with no special-casing:

- **Each city+date is a separate Luma event** → a separate `events` row keyed by
  `luma_event_id`. City, date, and timezone are established **at ingestion from Luma**
  (`lib/events/register.ts`): `start_at`, `end_at`, `timezone`, and
  `location = geo_address_json.city`.
- **The `events` table (Luma-sourced) is the single source of truth for city + date.**
  Feedback rows never override it.
- **Event filter tabs** are keyed by `luma_event_id` and labeled `City — Mon YYYY`,
  formatted **in that event's own `timezone`** (so a Sydney stop and an NYC stop read as
  their correct local dates). Two events in the same city on different dates remain
  distinct tabs.
- **"All events"** is the whole-series roll-up; each stop also has its own per-event view.
- Null city (a virtual stop) renders as `Online`.

## 3. Feedback data source (verified)

- The feedback database is **shared with Build Bar** and already reachable by notion-101's
  existing `NOTION_TOKEN` (verified — no re-sharing, no secret copying).
- IDs are pinned as constants (matching OfficeHours' convention), overridable by optional
  env `NOTION_FEEDBACK_DB_ID` / `NOTION_FEEDBACK_DATA_SOURCE_ID`:
  - `FEEDBACK_DB = d9ffd103ba354e35aeaf8e11101c2a42`
  - `FEEDBACK_DS = 3d542dad-4839-4dae-b56f-911c0e60fb11`
- **Project discriminator:** the DB has an `Event` **select** = `"Build Bar" | "Notion 101"`.
  The importer filters to `Event = "Notion 101"`. (Today: 5 rows, all Build Bar; 0 Notion 101
  — the feature is correct but empty until real Notion 101 responses arrive.)

### Property map (pinned from the live schema)

| Our field           | Notion property                                                    | Kind         |
|---------------------|--------------------------------------------------------------------|--------------|
| respondent_name     | `What is your name?`                                                | rich_text    |
| respondent_email    | `What email do you use for Notion?`                                 | email        |
| satisfaction_label  | `How satisfied were you with this event?` (`"5 - Amazing"`)         | select       |
| satisfaction_score  | leading integer parsed from the label (`5`)                        | derived      |
| confidence          | `How confident are you using Notion after this event vs. before?`   | select       |
| interests           | `Would you be interested in any of these?`                          | multi_select |
| feature_intent      | `Which feature or workflow will you try this week?`                 | rich_text    |
| highlight           | `What was the highlight, and anything we should improve?`           | rich_text    |
| submitted_at        | page `created_time`                                                 | timestamp    |

`Notion Expert` and `Needs review` columns are ignored (1:1-only).

### Tagging dependency (conscious choice)

New Notion 101 responses are **tagged `Event="Notion 101"` upstream** by OfficeHours' existing
feedback-enrichment pipeline, which looks respondents up in the Notion 101 Guest Database that
notion-101 populates. notion-101 **only reads**. This keeps one enrichment pipeline instead of
two. If OfficeHours is ever retired, notion-101 would need to own tagging — noted as a future
consideration, not built now.

## 4. Storage — new Neon `feedback` table

```sql
create table if not exists feedback (
  notion_page_id   text primary key,               -- source row; idempotent upsert key
  event_id         uuid references events(id) on delete set null,
  guest_id         uuid references guests(id) on delete set null,
  respondent_name  text,
  respondent_email text,
  satisfaction_score  int,                          -- 1..5
  satisfaction_label  text,
  confidence       text,                            -- raw select label
  interests        text[],
  feature_intent   text,
  highlight        text,
  submitted_at     timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists feedback_event_idx on feedback(event_id);
```

Content is persisted so the dashboard and feedback page aggregate in SQL — **no live Notion
reads on page load** (same rationale as OfficeHours migration 0021).

## 5. Ingestion pipeline

- `lib/notion/feedback.ts` — property readers + `FB` name constants + pinned IDs
  (ported/trimmed from OfficeHours).
- `lib/events/feedback-import.ts` — queries the feedback DS filtered to `Event="Notion 101"`
  (paginated), maps each page, resolves the event, upserts into `feedback` by `notion_page_id`.
- **Matching (local, no extra Notion reads) — robust to feedback that arrives days/weeks later.**
  Feedback carries only a name + a "What email do you use for Notion?" value, and that email may
  differ from the RSVP email. Since each guest row is tied to exactly one event, email→guest→event
  is authoritative and normally unique for a series (a person attends one city), so a late response
  still maps to the correct stop — **no time window is required**. Steps:
  1. **Email match (primary):** lowercase the respondent email; match against `guests.email` **or
     any value in that guest's `answers` jsonb** (which includes their Notion account email) —
     qid-independent, so it survives the per-event question-id differences.
  2. **Name match (fallback):** if email matched nothing, match `guests.name` (case-insensitive)
     against the RSVP list.
  3. **Disambiguation:** if the matched respondent has a single event, use it (regardless of how
     many days later the feedback arrived). If they attended multiple stops (repeat attendee),
     pick the most recent event dated **on/before** the submission date
     (`selectEventForFeedback`, pure + unit-tested).
  - No match → store with `event_id = null` and count it as *unattributed* (surfaced, never dropped).
  - Known limitation: name-fallback could collide for two different people with the same name in
    different cities; email is tried first and is authoritative, so this only affects the minority
    of email-unmatched rows, and the most-recent-on/before tiebreak keeps it best-effort.
- **Trigger:** `app/api/cron/feedback-import/route.ts` (hourly Vercel cron, `CRON_SECRET`-auth)
  and the dashboard **Refresh** button. Also invoked from the existing reconcile for a single
  "sync everything" path.

## 6. Dashboard aggregation (`lib/hub/results.ts`, ported)

Pure functions over `feedback` + event summaries, grouped by `luma_event_id` with an
`__all__` roll-up:

- **Attendance:** registered / approved / checked-in / **no-shows (= approved − checked-in)** /
  waitlist; rate = checked-in / approved. (Counts come from the existing `guests` aggregation.)
- **Satisfaction:** responses, response rate = responses / checked-in, avg /5, 1–5 star
  distribution.
- **Confidence lift:** much-more / somewhat / same / less + % more confident
  (= (much + somewhat) / answered).
- **Interested in:** interest labels ranked by count.
- **Community (cross-event):** unique attendees vs repeat (checked-in email in ≥2 distinct
  events), repeat rate. This is where series repeat-attendance shows up.

## 7. UI

- `components/AppNav.tsx` — shared shell: title + **Dashboard · Feedback · Settings** +
  `+ Add event` + **Refresh**. Replaces the inline header in `Dashboard.tsx`; added to the
  feedback page and settings pages.
- `components/EventTabs.tsx` — `All events` + one tab per event (`City — Mon YYYY`, event-tz
  formatted), keyed by `luma_event_id`; drives both Dashboard and Feedback via a
  `?event=<luma_event_id>` query param.
- **Dashboard** (`app/page.tsx` + `components/Dashboard.tsx`): metric cards from §6 for the
  selected event (or the series roll-up). Existing Recent-Emails and Sync-Log tables move
  below the metrics (kept, not removed).
- **Feedback** (`app/feedback/page.tsx`): event tabs + search box + table:
  Name · Event · Satisfaction · Confidence · Interests · Will try · Highlight/Improve · Submitted.
- **Settings:** unchanged; just linked from `AppNav`.

## 8. Config / env

- `NOTION_FEEDBACK_DB_ID`, `NOTION_FEEDBACK_DATA_SOURCE_ID` — optional overrides (defaults
  pinned in code). Added to `.env.example`.
- Vercel cron entry for `/api/cron/feedback-import` (hourly) in `vercel.json`.
- No new token; existing `NOTION_TOKEN` already has access.

## 9. Testing (vitest, pure functions)

- `parseSatisfactionScore`, property readers (mapping) — `tests/feedback-notion.test.ts`
- `selectEventForFeedback` / date-window matching — `tests/feedback-matching.test.ts`
- `feedbackRollup`, confidence buckets, interest ranking, response rate — `tests/results.test.ts`
- `computeCommunity` repeat-attendance across a multi-city series — same file
- Event-label formatting across timezones (Sydney vs NYC) — `tests/event-label.test.ts`

## 10. Non-goals / YAGNI

- No region/continent grouping layer above events (flat per-event + series roll-up is enough;
  extensible later if needed).
- No feedback webhook (hourly cron + Refresh is sufficient; real-time can be added later).
- notion-101 does not tag feedback rows (§3 dependency).
