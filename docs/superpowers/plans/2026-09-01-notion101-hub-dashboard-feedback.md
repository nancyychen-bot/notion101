# Notion 101 Hub — Dashboard, Event Results & Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give notion-101 a series-ready, event-filtered dashboard and a feedback page fed by the shared Notion feedback database (filtered to `Event="Notion 101"`), matching responses to local guests/events by email.

**Architecture:** Feedback rows are pulled hourly (and on-demand via a Refresh button) from the shared Notion feedback data source, matched to notion-101's own Neon `guests`/`events` by email + date window, and persisted to a new `feedback` table. Dashboard and `/feedback` render from Neon via pure aggregation functions — no live Notion reads on page load. Every city+date is its own Luma-ingested event; city/date/timezone (already captured at ingestion) drive per-event tabs and labels.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon Postgres (`@neondatabase/serverless` tagged-template `sql`), `@notionhq/client` (2022-06-28 databases API), Tailwind, Vitest.

**Reference implementation:** `/tmp/OfficeHours` (the Build Bar hub this is ported from). Spec: `docs/superpowers/specs/2026-09-01-notion101-hub-dashboard-feedback-design.md`.

---

## File Structure

**Create:**
- `lib/notion/feedback.ts` — feedback property-name constants, pinned DB/DS ids, `parseSatisfactionScore`, property readers, `readFeedbackContent`, `fetchNotion101FeedbackPages`.
- `lib/events/feedback-match.ts` — pure `EventCandidate`, `selectEventForFeedback` (identity-based, no time window).
- `lib/db/feedback.ts` — `UpsertFeedback`, `upsertFeedback`, `candidatesByEmail`, `candidatesByName`, `listFeedbackWithEvents`.
- `lib/events/feedback-import.ts` — `importFeedback` orchestrator.
- `lib/hub/format.ts` — `eventLabel` (timezone-aware).
- `lib/hub/results.ts` — `FeedbackRecord`, `EventSummary`, `feedbackRollup`, `computeResults`, `computeCommunity`.
- `app/api/cron/feedback-import/route.ts` — cron trigger.
- `app/api/feedback-import/route.ts` — session-guarded Refresh trigger.
- `components/AppNav.tsx` — shared top nav.
- `components/EventTabs.tsx` — event filter tabs (client).
- `components/RefreshButton.tsx` — client Refresh button.
- `components/FeedbackTable.tsx` — feedback table + search (client).
- `app/feedback/page.tsx` — feedback page.
- Tests: `tests/feedback-notion.test.ts`, `tests/feedback-match.test.ts`, `tests/results.test.ts`, `tests/event-label.test.ts`.

**Modify:**
- `lib/db/schema.sql` — append `feedback` table.
- `lib/db/dashboard.ts` — add `location`/`timezone` to `eventSummaries`; add `feedbackForResults`, `checkedInAttendees`.
- `components/Dashboard.tsx` + `app/page.tsx` — metric cards + event filter.
- `.env.example` — optional feedback overrides.
- `vercel.json` — hourly `feedback-import` cron.

---

## Task 1: `feedback` table (Neon schema)

**Files:**
- Modify: `lib/db/schema.sql` (append)

- [ ] **Step 1: Append the table to `lib/db/schema.sql`**

```sql

create table if not exists feedback (
  notion_page_id   text primary key,
  event_id         uuid references events(id) on delete set null,
  guest_id         uuid references guests(id) on delete set null,
  respondent_name  text,
  respondent_email text,
  satisfaction_score  int,
  satisfaction_label  text,
  confidence       text,
  interests        text[],
  feature_intent   text,
  highlight        text,
  submitted_at     timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists feedback_event_idx on feedback(event_id);
```

- [ ] **Step 2: Apply to Neon**

Run: `psql "$DATABASE_URL" -f lib/db/schema.sql` (or paste the new statements into the Neon SQL editor). Uses `DATABASE_URL` from `.env.local`.
Expected: `CREATE TABLE` / `CREATE INDEX` (no error; re-runnable).

- [ ] **Step 3: Verify the table exists**

Run: `psql "$DATABASE_URL" -c "\d feedback"`
Expected: columns listed as above.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.sql
git commit -m "feat(db): add feedback table for Notion 101 survey responses"
```

---

## Task 2: Notion feedback readers + constants

**Files:**
- Create: `lib/notion/feedback.ts`
- Test: `tests/feedback-notion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/feedback-notion.test.ts
import { describe, it, expect } from "vitest";
import { parseSatisfactionScore, readFeedbackContent, readFeedbackEmail, readFeedbackName } from "../lib/notion/feedback";

const props = {
  "What is your name?": { type: "rich_text", rich_text: [{ plain_text: "Ada Lovelace" }] },
  "What email do you use for Notion?": { type: "email", email: "ada@example.com" },
  "How satisfied were you with this event?": { type: "select", select: { name: "5 - Amazing" } },
  "How confident are you using Notion after this event vs. before?": { type: "select", select: { name: "Much more confident" } },
  "Would you be interested in any of these?": { type: "multi_select", multi_select: [{ name: "Joining a beta" }, { name: "Creating a template" }] },
  "Which feature or workflow will you try this week?": { type: "rich_text", rich_text: [{ plain_text: "Databases" }] },
  "What was the highlight, and anything we should improve?": { type: "rich_text", rich_text: [{ plain_text: "Great session" }] },
};

describe("feedback notion readers", () => {
  it("parses the leading integer of a satisfaction label", () => {
    expect(parseSatisfactionScore("5 - Amazing")).toBe(5);
    expect(parseSatisfactionScore("2 - Meh")).toBe(2);
    expect(parseSatisfactionScore("")).toBeNull();
    expect(parseSatisfactionScore(null)).toBeNull();
  });

  it("reads name + email", () => {
    expect(readFeedbackName(props)).toBe("Ada Lovelace");
    expect(readFeedbackEmail(props)).toBe("ada@example.com");
  });

  it("reads full feedback content", () => {
    expect(readFeedbackContent(props)).toEqual({
      satisfactionLabel: "5 - Amazing",
      satisfactionScore: 5,
      confidence: "Much more confident",
      interests: ["Joining a beta", "Creating a template"],
      featureIntent: "Databases",
      highlight: "Great session",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feedback-notion.test.ts`
Expected: FAIL — cannot find module `../lib/notion/feedback`.

- [ ] **Step 3: Create `lib/notion/feedback.ts`**

```ts
import { getNotionClient } from "./client";
import { env } from "../env";

/** Property names pinned from the live shared "Build Bar Feedback" schema. */
export const FB = {
  name: "What is your name?",
  email: "What email do you use for Notion?",
  event: "Event", // select: "Build Bar" | "Notion 101"
  satisfaction: "How satisfied were you with this event?",
  confidence: "How confident are you using Notion after this event vs. before?",
  featureIntent: "Which feature or workflow will you try this week?",
  highlight: "What was the highlight, and anything we should improve?",
  interests: "Would you be interested in any of these?",
} as const;

/** Pinned ids (override via env if the DB is recreated). */
export const FEEDBACK_DB_ID = env.notion.feedbackDbId() ?? "d9ffd103ba354e35aeaf8e11101c2a42";
export const EVENT_TAG = "Notion 101"; // the Event select value we ingest

type Props = Record<string, unknown>;

/** Leading integer of a satisfaction select ("5 - Amazing" → 5); null otherwise. */
export function parseSatisfactionScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function selectName(props: Props, name: string): string | null {
  const p = props[name] as { select?: { name?: string } | null } | undefined;
  return p?.select?.name ?? null;
}
function richText(props: Props, name: string): string | null {
  const p = props[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.rich_text?.length) return null;
  return p.rich_text.map((r) => r.plain_text ?? "").join("") || null;
}
function multiSelect(props: Props, name: string): string[] {
  const p = props[name] as { multi_select?: Array<{ name: string }> } | undefined;
  return (p?.multi_select ?? []).map((o) => o.name);
}

export function readFeedbackEmail(props: Props): string | null {
  const p = props[FB.email] as { email?: string | null } | undefined;
  return p?.email ?? null;
}
export function readFeedbackName(props: Props): string | null {
  return richText(props, FB.name);
}

export interface FeedbackContent {
  satisfactionLabel: string | null;
  satisfactionScore: number | null;
  confidence: string | null;
  interests: string[];
  featureIntent: string | null;
  highlight: string | null;
}
export function readFeedbackContent(props: Props): FeedbackContent {
  const satisfactionLabel = selectName(props, FB.satisfaction);
  return {
    satisfactionLabel,
    satisfactionScore: parseSatisfactionScore(satisfactionLabel),
    confidence: selectName(props, FB.confidence),
    interests: multiSelect(props, FB.interests),
    featureIntent: richText(props, FB.featureIntent),
    highlight: richText(props, FB.highlight),
  };
}

export interface FeedbackPage {
  id: string;
  createdTime: string;
  props: Props;
}

/** Fetch every feedback page tagged Event="Notion 101" (paginated). */
export async function fetchNotion101FeedbackPages(): Promise<FeedbackPage[]> {
  const notion = getNotionClient();
  const out: FeedbackPage[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await notion.databases.query({
      database_id: FEEDBACK_DB_ID,
      page_size: 100,
      start_cursor: cursor,
      filter: { property: FB.event, select: { equals: EVENT_TAG } },
    } as never)) as any;
    for (const pg of res.results) {
      out.push({ id: pg.id, createdTime: pg.created_time, props: pg.properties });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}
```

- [ ] **Step 4: Add the env getter used above**

Modify `lib/env.ts` — add to the `notion` object (after `webhookSecret`):

```ts
    webhookSecret: () => optional("NOTION_WEBHOOK_SECRET"),
    feedbackDbId: () => optional("NOTION_FEEDBACK_DB_ID"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/feedback-notion.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/notion/feedback.ts lib/env.ts tests/feedback-notion.test.ts
git commit -m "feat(notion): feedback property readers + Notion 101 page fetch"
```

---

## Task 3: Pure event-matching for feedback

**Files:**
- Create: `lib/events/feedback-match.ts`
- Test: `tests/feedback-match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/feedback-match.test.ts
import { describe, it, expect } from "vitest";
import { selectEventForFeedback } from "../lib/events/feedback-match";

describe("feedback matching", () => {
  it("uses the single matched event even when feedback arrives weeks later", () => {
    // No time window: a response 3 weeks after the only event still attributes to it.
    const cands = [{ eventId: "nyc", guestId: "g1", eventDate: "2026-09-01" }];
    expect(selectEventForFeedback(cands, "2026-09-22T10:00:00Z")?.eventId).toBe("nyc");
  });

  it("for a repeat attendee, picks the most recent event on/before submission", () => {
    const cands = [
      { eventId: "nyc", guestId: "g1", eventDate: "2026-08-01" },
      { eventId: "sf", guestId: "g2", eventDate: "2026-08-27" },
      { eventId: "future", guestId: "g3", eventDate: "2026-09-05" }, // after submission → ignored
    ];
    expect(selectEventForFeedback(cands, "2026-08-28T10:00:00Z")?.eventId).toBe("sf");
  });

  it("returns null when there are no candidates", () => {
    expect(selectEventForFeedback([], "2026-08-28T10:00:00Z")).toBeNull();
  });

  it("falls back to the earliest event if every candidate is dated after submission", () => {
    // Defensive: shouldn't happen (feedback follows the event), but never drop a real match.
    const cands = [
      { eventId: "a", guestId: "g1", eventDate: "2026-09-10" },
      { eventId: "b", guestId: "g2", eventDate: "2026-09-20" },
    ];
    expect(selectEventForFeedback(cands, "2026-09-01T10:00:00Z")?.eventId).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feedback-match.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `lib/events/feedback-match.ts`**

```ts
export interface EventCandidate {
  eventId: string;
  guestId: string;
  eventDate: string; // ISO "YYYY-MM-DD"
}

/**
 * Choose which event a feedback response belongs to. The candidates are the
 * events the matched respondent (by email or name) attended — already
 * authoritative, so there is NO time window: a response that arrives weeks after
 * the event still attributes correctly.
 *
 * - 0 candidates            → null
 * - 1 candidate             → that event (any lateness)
 * - repeat attendee (>1)    → most recent event dated on/before submission
 * - (defensive) all after   → earliest, so a real match is never dropped
 */
export function selectEventForFeedback(
  candidates: EventCandidate[],
  submittedAtISO: string,
): EventCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const sub = submittedAtISO.slice(0, 10);
  const onOrBefore = candidates.filter((c) => c.eventDate <= sub);
  if (onOrBefore.length > 0) {
    return onOrBefore.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
  }
  // Every candidate is dated after submission — pick the earliest.
  return candidates.reduce((a, b) => (b.eventDate < a.eventDate ? b : a));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feedback-match.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events/feedback-match.ts tests/feedback-match.test.ts
git commit -m "feat(events): pure event-matching for feedback responses"
```

---

## Task 4: Feedback DB access layer

**Files:**
- Create: `lib/db/feedback.ts`

- [ ] **Step 1: Create `lib/db/feedback.ts`**

```ts
import { sql } from "./client";
import type { EventCandidate } from "../events/feedback-match";

export interface UpsertFeedback {
  notionPageId: string;
  eventId: string | null;
  guestId: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  satisfactionScore: number | null;
  satisfactionLabel: string | null;
  confidence: string | null;
  interests: string[];
  featureIntent: string | null;
  highlight: string | null;
  submittedAt: string | null;
}

export async function upsertFeedback(f: UpsertFeedback): Promise<void> {
  await sql`
    insert into feedback (
      notion_page_id, event_id, guest_id, respondent_name, respondent_email,
      satisfaction_score, satisfaction_label, confidence, interests,
      feature_intent, highlight, submitted_at, updated_at)
    values (
      ${f.notionPageId}, ${f.eventId}, ${f.guestId}, ${f.respondentName}, ${f.respondentEmail},
      ${f.satisfactionScore}, ${f.satisfactionLabel}, ${f.confidence}, ${f.interests as unknown as string},
      ${f.featureIntent}, ${f.highlight}, ${f.submittedAt}, now())
    on conflict (notion_page_id) do update set
      event_id = excluded.event_id, guest_id = excluded.guest_id,
      respondent_name = excluded.respondent_name, respondent_email = excluded.respondent_email,
      satisfaction_score = excluded.satisfaction_score, satisfaction_label = excluded.satisfaction_label,
      confidence = excluded.confidence, interests = excluded.interests,
      feature_intent = excluded.feature_intent, highlight = excluded.highlight,
      submitted_at = excluded.submitted_at, updated_at = now()
  `;
}

type CandRow = { event_id: string; guest_id: string; event_date: string };
const toCand = (rows: CandRow[]): EventCandidate[] =>
  rows.map((r) => ({ eventId: r.event_id, guestId: r.guest_id, eventDate: r.event_date }));

/**
 * Candidate {event,guest} rows whose guest matches the respondent EMAIL — the
 * survey's "What email do you use for Notion?" may differ from the RSVP email,
 * so we match it against `guests.email` OR any value in the guest's `answers`
 * jsonb (which includes their Notion account email). Qid-independent.
 */
export async function candidatesByEmail(email: string): Promise<EventCandidate[]> {
  const wanted = email.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, g.id as guest_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date
    from guests g join events e on e.id = g.event_id
    where e.start_at is not null and (
      lower(g.email) = lower(${wanted})
      or exists (
        select 1 from jsonb_each_text(coalesce(g.answers, '{}'::jsonb)) je
        where lower(je.value) = lower(${wanted})
      )
    )
  `) as CandRow[];
  return toCand(rows);
}

/** Fallback: candidate rows whose guest NAME matches the respondent (case-insensitive). */
export async function candidatesByName(name: string): Promise<EventCandidate[]> {
  const wanted = name.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, g.id as guest_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date
    from guests g join events e on e.id = g.event_id
    where e.start_at is not null and lower(g.name) = lower(${wanted})
  `) as CandRow[];
  return toCand(rows);
}

export interface FeedbackWithEvent {
  notion_page_id: string;
  luma_event_id: string | null;
  event_name: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  satisfaction_score: number | null;
  confidence: string | null;
  interests: string[];
  feature_intent: string | null;
  highlight: string | null;
  submitted_at: string | null;
}

export async function listFeedbackWithEvents(): Promise<FeedbackWithEvent[]> {
  return (await sql`
    select f.notion_page_id, e.luma_event_id, e.name as event_name,
      f.respondent_name, f.respondent_email, f.satisfaction_score, f.confidence,
      f.interests, f.feature_intent, f.highlight, f.submitted_at
    from feedback f left join events e on e.id = f.event_id
    order by f.submitted_at desc nulls last
  `) as never;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/feedback.ts
git commit -m "feat(db): feedback upsert, email candidates, list-with-events"
```

---

## Task 5: Feedback importer

**Files:**
- Create: `lib/events/feedback-import.ts`

- [ ] **Step 1: Create `lib/events/feedback-import.ts`**

```ts
import {
  fetchNotion101FeedbackPages,
  readFeedbackContent,
  readFeedbackEmail,
  readFeedbackName,
} from "../notion/feedback";
import { candidatesByEmail, candidatesByName, upsertFeedback } from "../db/feedback";
import { selectEventForFeedback } from "./feedback-match";
import { logSync } from "../db/sync-log";

export interface ImportResult {
  imported: number;
  matched: number;
  unattributed: number;
}

/**
 * Pull every Event="Notion 101" feedback row, match each to a local guest/event,
 * and upsert into the feedback table. Idempotent by notion_page_id. Feedback can
 * arrive days/weeks after the event, so matching is by identity (email, then
 * name), NOT a time window — email→guest→event is authoritative for a series.
 * Unmatched rows are stored with null event and counted.
 */
export async function importFeedback(): Promise<ImportResult> {
  const pages = await fetchNotion101FeedbackPages();
  let imported = 0;
  let matched = 0;
  let unattributed = 0;

  for (const pg of pages) {
    const email = readFeedbackEmail(pg.props);
    const name = readFeedbackName(pg.props);
    const content = readFeedbackContent(pg.props);

    // Email first (authoritative); fall back to name against the RSVP list.
    let candidates = email ? await candidatesByEmail(email) : [];
    if (candidates.length === 0 && name) candidates = await candidatesByName(name);
    const chosen = selectEventForFeedback(candidates, pg.createdTime);
    const eventId = chosen?.eventId ?? null;
    const guestId = chosen?.guestId ?? null;
    if (eventId) matched++;
    else unattributed++;

    await upsertFeedback({
      notionPageId: pg.id,
      eventId,
      guestId,
      respondentName: readFeedbackName(pg.props),
      respondentEmail: email,
      satisfactionScore: content.satisfactionScore,
      satisfactionLabel: content.satisfactionLabel,
      confidence: content.confidence,
      interests: content.interests,
      featureIntent: content.featureIntent,
      highlight: content.highlight,
      submittedAt: pg.createdTime,
    });
    imported++;
  }

  await logSync({
    direction: "cron",
    result: "applied",
    action: "feedback_import",
    note: `imported=${imported} matched=${matched} unattributed=${unattributed}`,
  });
  return { imported, matched, unattributed };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirm `logSync` accepts `{direction, result, action, note}` — see `lib/db/sync-log.ts`; it does, matching `register.ts` usage.)

- [ ] **Step 3: Commit**

```bash
git add lib/events/feedback-import.ts
git commit -m "feat(events): feedback importer (fetch, match, upsert)"
```

---

## Task 6: Cron + Refresh routes

**Files:**
- Create: `app/api/cron/feedback-import/route.ts`
- Create: `app/api/feedback-import/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

```ts
// app/api/cron/feedback-import/route.ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { importFeedback } from "@/lib/events/feedback-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await importFeedback();
  return NextResponse.json(r);
}
export const GET = POST;
```

- [ ] **Step 2: Create the session-guarded Refresh route**

```ts
// app/api/feedback-import/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { importFeedback } from "@/lib/events/feedback-import";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const sessionToken = cookies().get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(sessionToken, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await importFeedback();
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "import failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Add the cron to `vercel.json`** (append inside `crons`)

```json
    { "path": "/api/cron/reconcile", "schedule": "0 * * * *" },
    { "path": "/api/cron/feedback-import", "schedule": "0 * * * *" }
```

(Add a comma after the reconcile line; the feedback-import line is the new last entry.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/feedback-import/route.ts app/api/feedback-import/route.ts vercel.json
git commit -m "feat(api): feedback-import cron + session-guarded refresh route"
```

---

## Task 7: Timezone-aware event label

**Files:**
- Create: `lib/hub/format.ts`
- Test: `tests/event-label.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/event-label.test.ts
import { describe, it, expect } from "vitest";
import { eventLabel } from "../lib/hub/format";

describe("eventLabel", () => {
  it("labels City — Mon YYYY in the event timezone", () => {
    // 2026-09-29T20:00:00Z is Sep 29 in New York
    expect(eventLabel("New York", "2026-09-29T20:00:00.000Z", "America/New_York")).toBe("New York — Sep 2026");
  });

  it("uses the event's own tz so a UTC-evening event reads as the local day", () => {
    // 2026-08-31T23:00:00Z is Sep 1 in Sydney (UTC+10)
    expect(eventLabel("Sydney", "2026-08-31T23:00:00.000Z", "Australia/Sydney")).toBe("Sydney — Sep 2026");
  });

  it("falls back to Online when city is missing", () => {
    expect(eventLabel(null, "2026-09-29T20:00:00.000Z", null)).toBe("Online — Sep 2026");
  });

  it("returns just the city when date is missing", () => {
    expect(eventLabel("Austin", null, null)).toBe("Austin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/event-label.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `lib/hub/format.ts`**

```ts
/** "City — Mon YYYY", the month/year computed in the event's own timezone. */
export function eventLabel(
  city: string | null | undefined,
  startAtISO: string | null | undefined,
  timezone: string | null | undefined,
): string {
  const place = (city ?? "").trim() || "Online";
  if (!startAtISO) return place;
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
  if (timezone) opts.timeZone = timezone;
  let stamp: string;
  try {
    stamp = new Intl.DateTimeFormat("en-US", opts).format(new Date(startAtISO));
  } catch {
    stamp = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(startAtISO));
  }
  return `${place} — ${stamp}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/event-label.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hub/format.ts tests/event-label.test.ts
git commit -m "feat(hub): timezone-aware event label for series stops"
```

---

## Task 8: Aggregation (results + community)

**Files:**
- Create: `lib/hub/results.ts`
- Test: `tests/results.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/results.test.ts
import { describe, it, expect } from "vitest";
import { computeResults, computeCommunity, type EventSummary, type FeedbackRecord } from "../lib/hub/results";

const events: EventSummary[] = [
  { luma_event_id: "nyc", name: "Notion 101 NYC", start_at: "2026-09-29T20:00:00Z", location: "New York", timezone: "America/New_York",
    registered: 10, approved: 8, declined: 1, waitlist: 1, checked_in: 6 },
];
const feedback: FeedbackRecord[] = [
  { luma_event_id: "nyc", satisfaction_score: 5, confidence: "Much more confident", interests: ["Joining a beta"], feature_intent: "DBs", highlight: "Great", respondent_name: "A", respondent_email: "a@x.com", event_name: "Notion 101 NYC" },
  { luma_event_id: "nyc", satisfaction_score: 4, confidence: "Same", interests: ["Joining a beta", "Community"], feature_intent: null, highlight: null, respondent_name: "B", respondent_email: "b@x.com", event_name: "Notion 101 NYC" },
];

describe("computeResults", () => {
  it("computes attendance, satisfaction, confidence, interests per event", () => {
    const { perEvent } = computeResults(events, feedback);
    const r = perEvent[0];
    expect(r.registered).toBe(10);
    expect(r.noShow).toBe(2); // approved 8 - checked_in 6
    expect(r.attendanceRate).toBeCloseTo(6 / 8);
    expect(r.responses).toBe(2);
    expect(r.responseRate).toBeCloseTo(2 / 6);
    expect(r.avgSatisfaction).toBeCloseTo(4.5);
    expect(r.satisfactionDist[5]).toBe(1);
    expect(r.confidence.muchMore).toBe(1);
    expect(r.pctMoreConfident).toBeCloseTo(1 / 2);
    expect(r.interests[0]).toEqual({ label: "Joining a beta", count: 2 });
  });

  it("rolls up an overall bucket", () => {
    const { overall } = computeResults(events, feedback);
    expect(overall.key).toBe("__all__");
    expect(overall.responses).toBe(2);
  });
});

describe("computeCommunity", () => {
  it("counts repeat attendees across events by email", () => {
    const c = computeCommunity([
      { email: "a@x.com", name: "A", luma_event_id: "nyc" },
      { email: "A@X.com", name: "A", luma_event_id: "sf" },
      { email: "b@x.com", name: "B", luma_event_id: "nyc" },
    ]);
    expect(c.uniqueAttendees).toBe(2);
    expect(c.repeatAttendees).toBe(1);
    expect(c.repeatRate).toBeCloseTo(1 / 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/results.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `lib/hub/results.ts`**

```ts
export interface EventSummary {
  luma_event_id: string;
  name: string | null;
  start_at: string | null;
  location: string | null;
  timezone: string | null;
  registered: number;
  approved: number;
  declined: number;
  waitlist: number;
  checked_in: number;
}

export interface FeedbackRecord {
  luma_event_id: string | null;
  satisfaction_score: number | null;
  confidence: string | null;
  interests: string[];
  feature_intent: string | null;
  highlight: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  event_name: string | null;
}

export interface EventResult {
  key: string; // luma_event_id ("__all__" for overall)
  registered: number;
  approved: number;
  checkedIn: number;
  noShow: number;
  waitlist: number;
  attendanceRate: number;
  responses: number;
  responseRate: number;
  avgSatisfaction: number | null;
  satisfactionDist: Record<1 | 2 | 3 | 4 | 5, number>;
  confidence: { muchMore: number; somewhatMore: number; same: number; less: number; unknown: number };
  pctMoreConfident: number | null;
  interests: Array<{ label: string; count: number }>;
  comments: Array<{ name: string | null; featureIntent: string | null; highlight: string | null }>;
}

function rollup(feedback: FeedbackRecord[]) {
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const f of feedback) {
    const s = f.satisfaction_score;
    if (s && s >= 1 && s <= 5) dist[s as 1 | 2 | 3 | 4 | 5]++;
  }
  const scores = feedback.map((f) => f.satisfaction_score).filter((n): n is number => n != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const conf = { muchMore: 0, somewhatMore: 0, same: 0, less: 0, unknown: 0 };
  for (const f of feedback) {
    const c = (f.confidence ?? "").toLowerCase();
    if (c.startsWith("much more")) conf.muchMore++;
    else if (c.startsWith("somewhat")) conf.somewhatMore++;
    else if (c.includes("same")) conf.same++;
    else if (c.startsWith("less")) conf.less++;
    else conf.unknown++;
  }
  const answered = conf.muchMore + conf.somewhatMore + conf.same + conf.less;
  const pctMoreConfident = answered > 0 ? (conf.muchMore + conf.somewhatMore) / answered : null;

  const counts = new Map<string, number>();
  for (const f of feedback) for (const i of f.interests) counts.set(i, (counts.get(i) ?? 0) + 1);
  const interests = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  const comments = feedback
    .filter((f) => f.feature_intent || f.highlight)
    .map((f) => ({ name: f.respondent_name, featureIntent: f.feature_intent, highlight: f.highlight }));

  return { dist, avg, conf, pctMoreConfident, interests, comments, responses: feedback.length };
}

function build(key: string, e: Pick<EventSummary, "registered" | "approved" | "checked_in" | "waitlist">, feedback: FeedbackRecord[]): EventResult {
  const f = rollup(feedback);
  const noShow = Math.max(0, e.approved - e.checked_in);
  return {
    key,
    registered: e.registered,
    approved: e.approved,
    checkedIn: e.checked_in,
    noShow,
    waitlist: e.waitlist,
    attendanceRate: e.approved > 0 ? e.checked_in / e.approved : 0,
    responses: f.responses,
    responseRate: e.checked_in > 0 ? f.responses / e.checked_in : 0,
    avgSatisfaction: f.avg,
    satisfactionDist: f.dist,
    confidence: f.conf,
    pctMoreConfident: f.pctMoreConfident,
    interests: f.interests,
    comments: f.comments,
  };
}

export function computeResults(
  events: EventSummary[],
  feedback: FeedbackRecord[],
): { overall: EventResult; perEvent: EventResult[]; unattributed: number } {
  const perEvent = events.map((e) =>
    build(e.luma_event_id, e, feedback.filter((f) => f.luma_event_id === e.luma_event_id)),
  );
  const sum = (pick: (e: EventSummary) => number) => events.reduce((a, e) => a + pick(e), 0);
  const overallSummary = {
    registered: sum((e) => e.registered),
    approved: sum((e) => e.approved),
    checked_in: sum((e) => e.checked_in),
    waitlist: sum((e) => e.waitlist),
  };
  const overall = build("__all__", overallSummary, feedback);
  const unattributed = feedback.filter((f) => !f.luma_event_id).length;
  return { overall, perEvent, unattributed };
}

export interface AttendeeRow {
  email: string | null;
  name: string | null;
  luma_event_id: string;
}
export interface Community {
  uniqueAttendees: number;
  repeatAttendees: number;
  repeatRate: number;
  top: Array<{ email: string; name: string | null; events: number }>;
}

/** Repeat attendance: checked-in attendees grouped by email; ≥2 distinct events = repeat. */
export function computeCommunity(attendees: AttendeeRow[]): Community {
  const byEmail = new Map<string, { name: string | null; events: Set<string> }>();
  for (const a of attendees) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const rec = byEmail.get(email) ?? { name: a.name ?? null, events: new Set<string>() };
    rec.events.add(a.luma_event_id);
    byEmail.set(email, rec);
  }
  const people = [...byEmail.entries()].map(([email, r]) => ({ email, name: r.name, events: r.events.size }));
  const uniqueAttendees = people.length;
  const repeatAttendees = people.filter((p) => p.events >= 2).length;
  return {
    uniqueAttendees,
    repeatAttendees,
    repeatRate: uniqueAttendees > 0 ? repeatAttendees / uniqueAttendees : 0,
    top: people.filter((p) => p.events >= 2).sort((a, b) => b.events - a.events).slice(0, 10),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/results.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hub/results.ts tests/results.test.ts
git commit -m "feat(hub): results + community aggregation (attendance, satisfaction, confidence, interests, repeat)"
```

---

## Task 9: Dashboard queries

**Files:**
- Modify: `lib/db/dashboard.ts`

- [ ] **Step 1: Extend `eventSummaries` to include `location` + `timezone`**

Replace the `eventSummaries` function's return type and select so it also returns `location` and `timezone`:

```ts
export async function eventSummaries(): Promise<
  {
    id: string;
    luma_event_id: string;
    name: string | null;
    start_at: string | null;
    location: string | null;
    timezone: string | null;
    pending: number;
    approved: number;
    declined: number;
    waitlist: number;
    checked_in: number;
  }[]
> {
  return (await sql`
    select e.id, e.luma_event_id, e.name, e.start_at, e.location, e.timezone,
      count(*) filter (where g.luma_status='pending')::int   as pending,
      count(*) filter (where g.luma_status='approved')::int  as approved,
      count(*) filter (where g.luma_status='declined')::int  as declined,
      count(*) filter (where g.luma_status='waitlist')::int  as waitlist,
      count(*) filter (where g.checked_in_at is not null)::int as checked_in
    from events e left join guests g on g.event_id = e.id
    group by e.id order by e.start_at desc nulls last
  `) as never;
}
```

- [ ] **Step 2: Append two new query helpers to `lib/db/dashboard.ts`**

```ts
import type { FeedbackRecord, AttendeeRow } from "../hub/results";

/** Feedback joined to its event's luma id + name, for dashboard aggregation. */
export async function feedbackForResults(): Promise<FeedbackRecord[]> {
  return (await sql`
    select e.luma_event_id, e.name as event_name,
      f.satisfaction_score, f.confidence, f.interests, f.feature_intent, f.highlight,
      f.respondent_name, f.respondent_email
    from feedback f left join events e on e.id = f.event_id
  `) as never;
}

/** Checked-in attendees (email, name, event) for cross-event community stats. */
export async function checkedInAttendees(): Promise<AttendeeRow[]> {
  return (await sql`
    select g.email, g.name, e.luma_event_id
    from guests g join events e on e.id = g.event_id
    where g.checked_in_at is not null
  `) as never;
}
```

(Place the `import type` line with the other imports at the top of the file.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/dashboard.ts
git commit -m "feat(db): dashboard queries for feedback + checked-in attendees; event city/tz"
```

---

## Task 10: Shared nav + Refresh button + Event tabs

**Files:**
- Create: `components/AppNav.tsx`, `components/RefreshButton.tsx`, `components/EventTabs.tsx`

- [ ] **Step 1: Create `components/RefreshButton.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading">("idle");
  async function refresh() {
    setState("loading");
    try {
      await fetch("/api/feedback-import", { method: "POST" });
      router.refresh();
    } finally {
      setState("idle");
    }
  }
  return (
    <button
      onClick={refresh}
      disabled={state === "loading"}
      className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
    >
      {state === "loading" ? "Refreshing…" : "Refresh"}
    </button>
  );
}
```

- [ ] **Step 2: Create `components/AppNav.tsx`**

```tsx
import { RefreshButton } from "./RefreshButton";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/feedback", label: "Feedback" },
  { href: "/settings/emails", label: "Settings" },
];

export function AppNav() {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Notion 101</h1>
        <nav className="flex gap-3 text-sm">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-neutral-600 hover:text-neutral-900">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <a href="/add-event" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          + Add event
        </a>
        <RefreshButton />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/EventTabs.tsx`**

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

export interface TabItem {
  key: string; // luma_event_id or "__all__"
  label: string;
}

export function EventTabs({ tabs, basePath }: { tabs: TabItem[]; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("event") ?? "__all__";
  function go(key: string) {
    const qs = key === "__all__" ? "" : `?event=${encodeURIComponent(key)}`;
    router.push(`${basePath}${qs}`);
  }
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => go(t.key)}
          className={`rounded-full px-3 py-1 text-sm ${
            active === t.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/AppNav.tsx components/RefreshButton.tsx components/EventTabs.tsx
git commit -m "feat(ui): shared AppNav, Refresh button, event filter tabs"
```

---

## Task 11: Dashboard with metric cards

**Files:**
- Modify: `components/Dashboard.tsx`, `app/page.tsx`

- [ ] **Step 1: Rewrite `components/Dashboard.tsx`**

```tsx
import type { ReactNode } from "react";
import { AppNav } from "./AppNav";
import { EventTabs, type TabItem } from "./EventTabs";
import { SyncButton } from "./SyncButton";
import type { EventResult, Community } from "@/lib/hub/results";

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export interface DashboardData {
  tabs: TabItem[];
  activeKey: string;
  result: EventResult;
  community: Community;
  syncEventId: string | null; // luma id when a single event is selected
}

export function Dashboard({ data }: { data: DashboardData }) {
  const r = data.result;
  const stars = [5, 4, 3, 2, 1] as const;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <EventTabs tabs={data.tabs} basePath="/" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Attendance">
          <div className="grid grid-cols-3 gap-4">
            <Stat value={r.registered} label="Registered" />
            <Stat value={r.approved} label="Approved" />
            <Stat value={r.checkedIn} label="Checked in" />
            <Stat value={r.noShow} label="No-shows" />
            <Stat value={r.waitlist} label="Waitlist" />
            <Stat value={pct(r.attendanceRate)} label="Attendance" />
          </div>
          {data.syncEventId && (
            <div className="mt-3"><SyncButton lumaEventId={data.syncEventId} /></div>
          )}
        </Card>

        <Card title="Satisfaction">
          <div className="mb-3 grid grid-cols-3 gap-4">
            <Stat value={r.responses} label="Responses" />
            <Stat value={pct(r.responseRate)} label="Response rate" />
            <Stat value={r.avgSatisfaction != null ? r.avgSatisfaction.toFixed(1) : "—"} label="Avg / 5" />
          </div>
          <div className="space-y-1">
            {stars.map((s) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-8 text-neutral-500">{s} ★</span>
                <span className="tabular-nums">{r.satisfactionDist[s]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Confidence lift">
          <div className="mb-2 text-sm">
            {r.pctMoreConfident != null ? `${pct(r.pctMoreConfident)} left more confident` : "No responses yet"}
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs text-neutral-600">
            <Stat value={r.confidence.muchMore} label="Much more" />
            <Stat value={r.confidence.somewhatMore} label="Somewhat" />
            <Stat value={r.confidence.same} label="Same" />
            <Stat value={r.confidence.less} label="Less" />
          </div>
        </Card>

        <Card title="Interested in">
          {r.interests.length === 0 ? (
            <p className="text-sm text-neutral-500">No responses yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.interests.map((i) => (
                <li key={i.label} className="flex justify-between">
                  <span>{i.label}</span>
                  <span className="tabular-nums text-neutral-500">{i.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-4">
        <Card title="Community — repeat attendance">
          <div className="grid grid-cols-3 gap-4">
            <Stat value={data.community.uniqueAttendees} label="Unique attendees" />
            <Stat value={data.community.repeatAttendees} label="Repeat attendees" />
            <Stat value={pct(data.community.repeatRate)} label="Repeat rate" />
          </div>
        </Card>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `app/page.tsx`**

```tsx
import { eventSummaries, feedbackForResults, checkedInAttendees } from "@/lib/db/dashboard";
import { computeResults, computeCommunity } from "@/lib/hub/results";
import { eventLabel } from "@/lib/hub/format";
import { Dashboard, type DashboardData } from "@/components/Dashboard";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: { event?: string } }) {
  const [events, feedback, attendees] = await Promise.all([
    eventSummaries(), feedbackForResults(), checkedInAttendees(),
  ]);
  const { overall, perEvent } = computeResults(events, feedback);
  const community = computeCommunity(attendees);

  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];

  const activeKey = searchParams.event ?? "__all__";
  const result = activeKey === "__all__"
    ? overall
    : perEvent.find((r) => r.key === activeKey) ?? overall;

  const data: DashboardData = {
    tabs,
    activeKey,
    result,
    community,
    syncEventId: activeKey === "__all__" ? null : activeKey,
  };
  return <Dashboard data={data} />;
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `/` and `/feedback` compile (feedback added next task — build after Task 12 if `/feedback` import is missing, or run typecheck only here).
Note: run only `npm run typecheck` here; full `npm run build` after Task 12.

- [ ] **Step 4: Commit**

```bash
git add components/Dashboard.tsx app/page.tsx
git commit -m "feat(dashboard): event-filtered metric cards (attendance, satisfaction, confidence, interests, community)"
```

---

## Task 12: Feedback page

**Files:**
- Create: `components/FeedbackTable.tsx`, `app/feedback/page.tsx`

- [ ] **Step 1: Create `components/FeedbackTable.tsx`**

```tsx
"use client";
import { useState } from "react";
import { EventTabs, type TabItem } from "./EventTabs";
import type { FeedbackWithEvent } from "@/lib/db/feedback";

export function FeedbackTable({
  rows, tabs, activeKey,
}: { rows: FeedbackWithEvent[]; tabs: TabItem[]; activeKey: string }) {
  const [q, setQ] = useState("");
  const filtered = rows.filter((r) => {
    if (activeKey !== "__all__" && r.luma_event_id !== activeKey) return false;
    if (!q.trim()) return true;
    const hay = [r.respondent_name, r.event_name, r.highlight, r.feature_intent, r.interests?.join(" ")]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <EventTabs tabs={tabs} basePath="/feedback" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, comment"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No feedback yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50 text-left">
                {["Name", "Event", "Satisfaction", "Confidence", "Interests", "Will try", "Highlight / improve", "Submitted"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.notion_page_id} className="border-b align-top hover:bg-neutral-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.respondent_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.event_name ?? "—"}</td>
                  <td className="px-3 py-2">{r.satisfaction_score != null ? `${r.satisfaction_score}/5` : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.confidence ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.interests?.length ? r.interests.join(", ") : "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.feature_intent ?? "—"}</td>
                  <td className="px-3 py-2 max-w-md">{r.highlight ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.submitted_at ? r.submitted_at.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/feedback/page.tsx`**

```tsx
import { AppNav } from "@/components/AppNav";
import { FeedbackTable } from "@/components/FeedbackTable";
import { listFeedbackWithEvents } from "@/lib/db/feedback";
import { eventSummaries } from "@/lib/db/dashboard";
import { eventLabel } from "@/lib/hub/format";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({ searchParams }: { searchParams: { event?: string } }) {
  const [rows, events] = await Promise.all([listFeedbackWithEvents(), eventSummaries()]);
  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];
  const activeKey = searchParams.event ?? "__all__";
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <p className="mb-4 text-sm text-neutral-500">Post-event feedback, matched to its Notion 101 event.</p>
      <FeedbackTable rows={rows} tabs={tabs} activeKey={activeKey} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `/` and `/feedback` both compile.

- [ ] **Step 4: Commit**

```bash
git add components/FeedbackTable.tsx app/feedback/page.tsx
git commit -m "feat(feedback): /feedback page with event tabs, search, response table"
```

---

## Task 13: Env docs, full test run, deploy, first import

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document the optional override in `.env.example`** (append under the Notion block)

```
NOTION_FEEDBACK_DB_ID=           # Optional — override the shared feedback DB id (default pinned in code)
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: all tests pass (existing 41 + new feedback/match/results/event-label tests).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(env): optional NOTION_FEEDBACK_DB_ID override"
```

- [ ] **Step 5: Deploy to production** (this project deploys via CLI, not git push)

Run: `npx vercel --prod --yes`
Expected: `Deployment … ready.`

- [ ] **Step 6: Trigger the first feedback import against prod**

Run:
```bash
SECRET=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")
curl -s -X POST https://notion-101.vercel.app/api/cron/feedback-import -H "x-cron-secret: $SECRET"
```
Expected: `{"imported":0,"matched":0,"unattributed":0}` today (no Notion 101 feedback rows yet — correct). Once real Notion 101 responses exist, counts rise and appear on `/` and `/feedback`.

- [ ] **Step 7: Verify the pages load**

Open `https://notion-101.vercel.app/` and `/feedback` (log in with the dashboard password). Expected: dashboard shows event tabs + metric cards; feedback page shows the empty-state until responses arrive.

---

## Notes for the implementer

- **`sql` array binding:** Neon's tagged template accepts a JS array for a `text[]` column; the `${f.interests as unknown as string}` cast in Task 4 silences the TS overload while passing the real array at runtime. If Neon rejects it, fall back to `${JSON.stringify(f.interests)}::text[]` — but try the array first.
- **`logSync` signature:** confirm against `lib/db/sync-log.ts` (used identically in `lib/events/register.ts`).
- **Reference code:** `/tmp/OfficeHours/lib/hub/results.ts`, `lib/notion/feedback.ts`, `lib/db/feedback.ts` are the originals this ports from — consult them if a formula is unclear.
- **No secrets to add:** the existing `NOTION_TOKEN` already reads the shared feedback DB (verified).
