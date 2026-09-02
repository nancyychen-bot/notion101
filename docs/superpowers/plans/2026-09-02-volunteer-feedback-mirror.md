# Volunteer Feedback Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the Ambassador-prod "Notion 101 Volunteer Feedback" database into the dev mirror DB (building its properties), persist each response to Neon, attribute it to a Luma event by City+date, and surface it on a new `/volunteers` hub page.

**Architecture:** An importer reads pages from the ambassador-prod DB (ambassador token), parses content + numeric scores, matches an event by City+date (reusing `selectEventForFeedback`), writes/updates a mirror page in the dev DB (existing dev `NOTION_TOKEN`), and upserts a Neon `volunteer_feedback` row. Idempotency is Neon-primary (`ambassador_page_id → dev_page_id`) with the id also stamped on the dev page as a recovery key. The hub reads only from Neon. Independent of the guest-feedback feature; reuses only `selectEventForFeedback` + `eventLabel`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon (`sql` tagged template), `@notionhq/client` ^2.2.15 (2022-06-28, classic-shape DBs, `parent: { database_id }` writes), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-volunteer-feedback-mirror-design.md`. **Reference:** `/tmp/OfficeHours` (expert-feedback analog).

---

## File Structure

**Create:**
- `lib/notion/volunteer-feedback.ts` — `VF` prop names, pinned ids, `parseScore`, readers, `readVolunteerContent`, `fetchVolunteerFeedbackPages`, `buildDevProperties`.
- `lib/db/volunteer-feedback.ts` — `UpsertVolunteerFeedback`, `upsertVolunteerFeedback`, `getDevPageId`, `eventsInCity`, `listVolunteerFeedback` (+ `VolunteerFeedbackRow`).
- `lib/events/volunteer-feedback-import.ts` — `importVolunteerFeedback`.
- `lib/hub/volunteer-summary.ts` — pure `volunteerSummary`.
- `app/api/cron/volunteer-feedback-import/route.ts`, `app/api/volunteer-feedback-import/route.ts`.
- `scripts/configure-volunteer-feedback-db.ts` — one-time dev DB schema build-out.
- `components/VolunteersTable.tsx`, `app/volunteers/page.tsx`.
- Tests: `tests/volunteer-feedback-notion.test.ts`, `tests/volunteer-summary.test.ts`.

**Modify:**
- `lib/db/schema.sql` (append `volunteer_feedback`), `lib/notion/client.ts` (add `getAmbassadorNotionClient`), `lib/env.ts` (ambassador token + volunteer db ids), `.env.example`, `vercel.json`, `components/AppNav.tsx` (Volunteers link), `components/RefreshButton.tsx` (fire both imports), `middleware.ts` (guard `/volunteers`), `package.json` (setup script).

---

## Task 1: `volunteer_feedback` table (Neon)

**Files:** Modify `lib/db/schema.sql`.

- [ ] **Step 1: Append to `lib/db/schema.sql`**

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

- [ ] **Step 2: Apply to Neon** — `psql "$DATABASE_URL" -f lib/db/schema.sql` (DATABASE_URL from `.env.local`). Expected: `CREATE TABLE` / `CREATE INDEX`, no error.
- [ ] **Step 3: Verify** — `psql "$DATABASE_URL" -c "\d volunteer_feedback"` shows the columns.
- [ ] **Step 4: Commit**
```bash
git add lib/db/schema.sql
git commit -m "feat(db): add volunteer_feedback table"
```

---

## Task 2: Env + ambassador client

**Files:** Modify `lib/env.ts`, `lib/notion/client.ts`.

- [ ] **Step 1: `lib/env.ts`** — inside the `notion` object, after `feedbackDbId: () => optional("NOTION_FEEDBACK_DB_ID"),` add:

```ts
    ambassadorToken: () => required("NOTION_AMBASSADOR_TOKEN"),
    volunteerProdDbId: () => optional("NOTION_VOLUNTEER_PROD_DB_ID"),
    volunteerDevDbId: () => optional("NOTION_VOLUNTEER_DEV_DB_ID"),
```

(`required` and `optional` already exist in this file.)

- [ ] **Step 2: `lib/notion/client.ts`** — add a second client for the ambassador workspace. Append:

```ts
let ambassadorClient: Client | null = null;
/** Notion client for the Ambassador prod workspace (separate token). */
export function getAmbassadorNotionClient(): Client {
  if (!ambassadorClient) ambassadorClient = new Client({ auth: env.notion.ambassadorToken() });
  return ambassadorClient;
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck`; expect no errors.
- [ ] **Step 4: Commit**
```bash
git add lib/env.ts lib/notion/client.ts
git commit -m "feat(notion): ambassador-workspace client + volunteer env getters"
```

---

## Task 3: Volunteer Notion readers + writer

**Files:** Create `lib/notion/volunteer-feedback.ts`; Test `tests/volunteer-feedback-notion.test.ts`.

- [ ] **Step 1: Write the failing test `tests/volunteer-feedback-notion.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import { parseScore, readVolunteerContent } from "../lib/notion/volunteer-feedback";

const props = {
  "Volunteer name": { type: "title", title: [{ plain_text: "Jamie Rivera" }] },
  "Volunteer type": { type: "select", select: { name: "Ambassador" } },
  "City": { type: "select", select: { name: "New York" } },
  "Track(s) supported": { type: "multi_select", multi_select: [{ name: "Services" }, { name: "E-commerce & Online" }] },
  "Preparedness": { type: "select", select: { name: "4 — Prepared" } },
  "Overall experience": { type: "select", select: { name: "5 — Excellent" } },
  "What worked well": { type: "rich_text", rich_text: [{ plain_text: "Great crowd" }] },
  "Challenges": { type: "rich_text", rich_text: [{ plain_text: "Wifi" }] },
  "Improvements": { type: "rich_text", rich_text: [{ plain_text: "More time" }] },
};

describe("volunteer feedback readers", () => {
  it("parses a leading score from an em-dash label", () => {
    expect(parseScore("5 — Excellent")).toBe(5);
    expect(parseScore("1 — Not prepared")).toBe(1);
    expect(parseScore("")).toBeNull();
    expect(parseScore(null)).toBeNull();
  });

  it("reads full volunteer content", () => {
    expect(readVolunteerContent(props)).toEqual({
      volunteerName: "Jamie Rivera",
      volunteerType: "Ambassador",
      city: "New York",
      tracks: ["Services", "E-commerce & Online"],
      preparednessLabel: "4 — Prepared",
      preparednessScore: 4,
      experienceLabel: "5 — Excellent",
      experienceScore: 5,
      whatWorked: "Great crowd",
      challenges: "Wifi",
      improvements: "More time",
    });
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/volunteer-feedback-notion.test.ts`; expect FAIL (module not found).**

- [ ] **Step 3: Create `lib/notion/volunteer-feedback.ts`:**

```ts
import { getAmbassadorNotionClient } from "./client";
import { env } from "../env";

/** Property names pinned from the live Ambassador "Notion 101 Volunteer Feedback" schema. */
export const VF = {
  name: "Volunteer name",
  type: "Volunteer type",
  city: "City",
  tracks: "Track(s) supported",
  preparedness: "Preparedness",
  experience: "Overall experience",
  whatWorked: "What worked well",
  challenges: "Challenges",
  improvements: "Improvements",
} as const;

/** Dev mirror property names (superset: content + scores + attribution + idempotency). */
export const VF_DEV = {
  name: "Volunteer name",
  type: "Volunteer type",
  city: "City",
  tracks: "Track(s) supported",
  preparedness: "Preparedness",
  preparednessScore: "Preparedness score",
  experience: "Overall experience",
  experienceScore: "Experience score",
  whatWorked: "What worked well",
  challenges: "Challenges",
  improvements: "Improvements",
  submitted: "Submitted",
  event: "Event",
  eventDate: "Event Date",
  ambassadorPageId: "Ambassador page ID",
} as const;

export const VOLUNTEER_PROD_DB_ID = env.notion.volunteerProdDbId() ?? "3ce3139dbfef809bbd60e1e4232e8238";
export const VOLUNTEER_DEV_DB_ID = env.notion.volunteerDevDbId() ?? "3ceb35e6e67f807d9fa4e219f3146462";

type Props = Record<string, unknown>;

/** Leading integer of a "5 — Excellent" label → 5 (em-dash tolerant); null otherwise. */
export function parseScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function title(props: Props, name: string): string | null {
  const p = props[name] as { title?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.title?.length) return null;
  return p.title.map((t) => t.plain_text ?? "").join("") || null;
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

export interface VolunteerContent {
  volunteerName: string | null;
  volunteerType: string | null;
  city: string | null;
  tracks: string[];
  preparednessLabel: string | null;
  preparednessScore: number | null;
  experienceLabel: string | null;
  experienceScore: number | null;
  whatWorked: string | null;
  challenges: string | null;
  improvements: string | null;
}

export function readVolunteerContent(props: Props): VolunteerContent {
  const preparednessLabel = selectName(props, VF.preparedness);
  const experienceLabel = selectName(props, VF.experience);
  return {
    volunteerName: title(props, VF.name),
    volunteerType: selectName(props, VF.type),
    city: selectName(props, VF.city),
    tracks: multiSelect(props, VF.tracks),
    preparednessLabel,
    preparednessScore: parseScore(preparednessLabel),
    experienceLabel,
    experienceScore: parseScore(experienceLabel),
    whatWorked: richText(props, VF.whatWorked),
    challenges: richText(props, VF.challenges),
    improvements: richText(props, VF.improvements),
  };
}

export interface VolunteerPage {
  id: string;
  createdTime: string;
  props: Props;
}

/** Fetch every page from the Ambassador prod volunteer-feedback DB (paginated). */
export async function fetchVolunteerFeedbackPages(): Promise<VolunteerPage[]> {
  const notion = getAmbassadorNotionClient();
  const out: VolunteerPage[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await notion.databases.query({
      database_id: VOLUNTEER_PROD_DB_ID,
      page_size: 100,
      start_cursor: cursor,
    } as never)) as any;
    for (const pg of res.results) out.push({ id: pg.id, createdTime: pg.created_time, props: pg.properties });
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

function rt(v: string | null) {
  return { rich_text: v ? [{ type: "text", text: { content: v.slice(0, 2000) } }] : [] };
}

/** Build the dev-mirror page write payload from parsed content + matched event. */
export function buildDevProperties(input: {
  content: VolunteerContent;
  submittedAtISO: string;
  eventName: string | null;
  eventDate: string | null;
  ambassadorPageId: string;
}): Props {
  const c = input.content;
  const props: Props = {
    [VF_DEV.name]: { title: c.volunteerName ? [{ type: "text", text: { content: c.volunteerName.slice(0, 2000) } }] : [] },
    [VF_DEV.tracks]: { multi_select: c.tracks.map((t) => ({ name: t })) },
    [VF_DEV.whatWorked]: rt(c.whatWorked),
    [VF_DEV.challenges]: rt(c.challenges),
    [VF_DEV.improvements]: rt(c.improvements),
    [VF_DEV.ambassadorPageId]: rt(input.ambassadorPageId),
    [VF_DEV.submitted]: { date: { start: input.submittedAtISO } },
  };
  if (c.volunteerType) props[VF_DEV.type] = { select: { name: c.volunteerType } };
  if (c.city) props[VF_DEV.city] = { select: { name: c.city } };
  if (c.preparednessLabel) props[VF_DEV.preparedness] = { select: { name: c.preparednessLabel } };
  if (c.preparednessScore != null) props[VF_DEV.preparednessScore] = { number: c.preparednessScore };
  if (c.experienceLabel) props[VF_DEV.experience] = { select: { name: c.experienceLabel } };
  if (c.experienceScore != null) props[VF_DEV.experienceScore] = { number: c.experienceScore };
  if (input.eventName) props[VF_DEV.event] = rt(input.eventName);
  if (input.eventDate) props[VF_DEV.eventDate] = { date: { start: input.eventDate } };
  return props;
}
```

- [ ] **Step 4: Run `npx vitest run tests/volunteer-feedback-notion.test.ts`; expect PASS (2 tests). Then `npm run typecheck`; expect no errors.**

- [ ] **Step 5: Commit**
```bash
git add lib/notion/volunteer-feedback.ts tests/volunteer-feedback-notion.test.ts
git commit -m "feat(notion): volunteer feedback readers, score parse, dev write payload"
```

---

## Task 4: Volunteer DB access layer

**Files:** Create `lib/db/volunteer-feedback.ts`.

- [ ] **Step 1: Create `lib/db/volunteer-feedback.ts`:**

```ts
import { sql } from "./client";
import type { EventCandidate } from "../events/feedback-match";

export interface UpsertVolunteerFeedback {
  ambassadorPageId: string;
  devPageId: string | null;
  eventId: string | null;
  volunteerName: string | null;
  volunteerType: string | null;
  city: string | null;
  tracks: string[];
  preparednessLabel: string | null;
  preparednessScore: number | null;
  experienceLabel: string | null;
  experienceScore: number | null;
  whatWorked: string | null;
  challenges: string | null;
  improvements: string | null;
  submittedAt: string | null;
}

export async function upsertVolunteerFeedback(f: UpsertVolunteerFeedback): Promise<void> {
  await sql`
    insert into volunteer_feedback (
      ambassador_page_id, dev_page_id, event_id, volunteer_name, volunteer_type, city,
      tracks, preparedness_label, preparedness_score, experience_label, experience_score,
      what_worked, challenges, improvements, submitted_at, updated_at)
    values (
      ${f.ambassadorPageId}, ${f.devPageId}, ${f.eventId}, ${f.volunteerName}, ${f.volunteerType}, ${f.city},
      ${f.tracks}, ${f.preparednessLabel}, ${f.preparednessScore}, ${f.experienceLabel}, ${f.experienceScore},
      ${f.whatWorked}, ${f.challenges}, ${f.improvements}, ${f.submittedAt}, now())
    on conflict (ambassador_page_id) do update set
      dev_page_id = excluded.dev_page_id, event_id = excluded.event_id,
      volunteer_name = excluded.volunteer_name, volunteer_type = excluded.volunteer_type, city = excluded.city,
      tracks = excluded.tracks, preparedness_label = excluded.preparedness_label,
      preparedness_score = excluded.preparedness_score, experience_label = excluded.experience_label,
      experience_score = excluded.experience_score, what_worked = excluded.what_worked,
      challenges = excluded.challenges, improvements = excluded.improvements,
      submitted_at = excluded.submitted_at, updated_at = now()
  `;
}

/** The dev mirror page id we last created for this source page, if any. */
export async function getDevPageId(ambassadorPageId: string): Promise<string | null> {
  const rows = (await sql`
    select dev_page_id from volunteer_feedback where ambassador_page_id = ${ambassadorPageId}
  `) as { dev_page_id: string | null }[];
  return rows[0]?.dev_page_id ?? null;
}

/** Candidate events in a city (for City+date attribution). guestId is unused ("" ). */
export async function eventsInCity(city: string): Promise<EventCandidate[]> {
  const wanted = city.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date, e.name as event_name
    from events e
    where e.start_at is not null and lower(e.location) = lower(${wanted})
  `) as { event_id: string; event_date: string; event_name: string | null }[];
  return rows.map((r) => ({ eventId: r.event_id, guestId: "", eventDate: r.event_date }));
}

export interface VolunteerFeedbackRow {
  ambassador_page_id: string;
  event_id: string | null;
  luma_event_id: string | null;
  event_name: string | null;
  volunteer_name: string | null;
  volunteer_type: string | null;
  city: string | null;
  tracks: string[];
  preparedness_label: string | null;
  preparedness_score: number | null;
  experience_label: string | null;
  experience_score: number | null;
  what_worked: string | null;
  challenges: string | null;
  improvements: string | null;
  submitted_at: string | null;
}

export async function listVolunteerFeedback(): Promise<VolunteerFeedbackRow[]> {
  return (await sql`
    select vf.ambassador_page_id, vf.event_id, e.luma_event_id, e.name as event_name,
      vf.volunteer_name, vf.volunteer_type, vf.city, vf.tracks,
      vf.preparedness_label, vf.preparedness_score, vf.experience_label, vf.experience_score,
      vf.what_worked, vf.challenges, vf.improvements, vf.submitted_at
    from volunteer_feedback vf left join events e on e.id = vf.event_id
    order by vf.submitted_at desc nulls last
  `) as never;
}
```

- [ ] **Step 2: `npm run typecheck`; expect no errors.**
- [ ] **Step 3: Commit**
```bash
git add lib/db/volunteer-feedback.ts
git commit -m "feat(db): volunteer_feedback upsert, dev-page lookup, city events, list"
```

---

## Task 5: Import orchestrator

**Files:** Create `lib/events/volunteer-feedback-import.ts`.

- [ ] **Step 1: Create `lib/events/volunteer-feedback-import.ts`:**

```ts
import {
  fetchVolunteerFeedbackPages, readVolunteerContent, buildDevProperties, VOLUNTEER_DEV_DB_ID,
} from "../notion/volunteer-feedback";
import { getNotionClient } from "../notion/client";
import { selectEventForFeedback } from "./feedback-match";
import {
  upsertVolunteerFeedback, getDevPageId, eventsInCity,
} from "../db/volunteer-feedback";
import { getEventById } from "../db/events";
import { logSync } from "../db/sync-log";

export interface VolunteerImportResult {
  imported: number;
  matched: number;
  unattributed: number;
}

/**
 * Mirror Ambassador-prod volunteer feedback into the dev DB + Neon. Idempotent by
 * ambassador page id (Neon-primary dev_page_id map). Attribution: City+date — the
 * most recent Notion 101 event in that city on/before the Submitted date.
 */
export async function importVolunteerFeedback(): Promise<VolunteerImportResult> {
  const dev = getNotionClient();
  const pages = await fetchVolunteerFeedbackPages();
  let imported = 0, matched = 0, unattributed = 0;

  for (const pg of pages) {
    const content = readVolunteerContent(pg.props);

    // City + date attribution.
    let eventId: string | null = null;
    let eventName: string | null = null;
    let eventDate: string | null = null;
    if (content.city) {
      const chosen = selectEventForFeedback(await eventsInCity(content.city), pg.createdTime);
      if (chosen) {
        eventId = chosen.eventId;
        const ev = await getEventById(chosen.eventId);
        eventName = ev?.name ?? null;
        eventDate = ev?.start_at ?? null;
      }
    }
    if (eventId) matched++; else unattributed++;

    // Write/refresh the dev mirror page (Neon-tracked idempotency).
    const props = buildDevProperties({
      content, submittedAtISO: pg.createdTime, eventName, eventDate, ambassadorPageId: pg.id,
    });
    let devPageId = await getDevPageId(pg.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (devPageId) {
      try {
        await dev.pages.update({ page_id: devPageId, properties: props as never });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not[ _]?found|could not find|archived/i.test(msg)) throw err;
        devPageId = null; // recreate below
      }
    }
    if (!devPageId) {
      const created = (await dev.pages.create({
        parent: { database_id: VOLUNTEER_DEV_DB_ID } as never,
        properties: props as never,
      })) as { id: string };
      devPageId = created.id;
    }

    await upsertVolunteerFeedback({
      ambassadorPageId: pg.id,
      devPageId,
      eventId,
      volunteerName: content.volunteerName,
      volunteerType: content.volunteerType,
      city: content.city,
      tracks: content.tracks,
      preparednessLabel: content.preparednessLabel,
      preparednessScore: content.preparednessScore,
      experienceLabel: content.experienceLabel,
      experienceScore: content.experienceScore,
      whatWorked: content.whatWorked,
      challenges: content.challenges,
      improvements: content.improvements,
      submittedAt: pg.createdTime,
    });
    imported++;
  }

  await logSync({
    direction: "cron", result: "applied", action: "volunteer_feedback_import",
    note: `imported=${imported} matched=${matched} unattributed=${unattributed}`,
  });
  return { imported, matched, unattributed };
}
```

- [ ] **Step 2: `npm run typecheck`; expect no errors. Confirm `getEventById` exists in `lib/db/events.ts` (it does) and returns `{ name, start_at, ... }`.**
- [ ] **Step 3: Commit**
```bash
git add lib/events/volunteer-feedback-import.ts
git commit -m "feat(events): volunteer feedback importer (fetch, match, dev mirror, upsert)"
```

---

## Task 6: Routes + cron + Refresh both

**Files:** Create two routes; Modify `vercel.json`, `components/RefreshButton.tsx`.

- [ ] **Step 1: `app/api/cron/volunteer-feedback-import/route.ts`:**
```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { importVolunteerFeedback } from "@/lib/events/volunteer-feedback-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await importVolunteerFeedback();
  return NextResponse.json(r);
}
export const GET = POST;
```

- [ ] **Step 2: `app/api/volunteer-feedback-import/route.ts`:**
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { importVolunteerFeedback } from "@/lib/events/volunteer-feedback-import";
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
    return NextResponse.json(await importVolunteerFeedback());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "import failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: `vercel.json`** — add as the new last cron entry (comma after the feedback-import line):
```json
    { "path": "/api/cron/feedback-import", "schedule": "0 * * * *" },
    { "path": "/api/cron/volunteer-feedback-import", "schedule": "0 * * * *" }
```

- [ ] **Step 4: `components/RefreshButton.tsx`** — fire BOTH imports in parallel. Replace the ENTIRE file with:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function refresh() {
    setState("loading");
    try {
      const [a, b] = await Promise.all([
        fetch("/api/feedback-import", { method: "POST" }),
        fetch("/api/volunteer-feedback-import", { method: "POST" }),
      ]);
      if (!a.ok || !b.ok) {
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }
  return (
    <span className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={state === "loading"}
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {state === "loading" ? "Refreshing…" : "Refresh"}
      </button>
      {state === "error" && <span className="text-xs text-red-600">Refresh failed</span>}
    </span>
  );
}
```

- [ ] **Step 5: `npm run typecheck`; expect no errors.**
- [ ] **Step 6: Commit**
```bash
git add app/api/cron/volunteer-feedback-import/route.ts app/api/volunteer-feedback-import/route.ts vercel.json components/RefreshButton.tsx
git commit -m "feat(api): volunteer-feedback cron + refresh route; Refresh fires both imports"
```

---

## Task 7: Dev DB schema build-out script

**Files:** Create `scripts/configure-volunteer-feedback-db.ts`; Modify `package.json`.

- [ ] **Step 1: Create `scripts/configure-volunteer-feedback-db.ts`:**
```ts
/**
 * Run once: build the dev "Volunteer Feedback Notion 101s" DB properties to match
 * the mirror writer (VF_DEV names). Uses databases.update (classic-shape DB).
 * Usage: npm run setup:volunteer-feedback
 */
import { Client } from "@notionhq/client";

const DB_ID = process.env.NOTION_VOLUNTEER_DEV_DB_ID ?? "3ceb35e6e67f807d9fa4e219f3146462";

const PREP = ["5 — Very prepared", "4 — Prepared", "3 — Somewhat prepared", "2 — Underprepared", "1 — Not prepared"];
const EXP = ["5 — Excellent", "4 — Good", "3 — Okay", "2 — Difficult", "1 — Poor"];
const TRACKS = ["Brick & Mortar", "E-commerce & Online", "Services", "Combined / General"];
const TYPES = ["Ambassador", "Notino", "Event partner", "Other volunteer"];
const CITIES = ["New York", "San Francisco"];
const opts = (names: string[]) => ({ options: names.map((name) => ({ name })) });

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const notion = new Client({ auth: token });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await notion.databases.retrieve({ database_id: DB_ID })) as any;
  const titleName = Object.entries(db.properties).find(([, v]: [string, any]) => v?.type === "title")?.[0] ?? "Name";

  const properties: Record<string, unknown> = {
    [titleName]: { name: "Volunteer name" }, // rename existing title
    "Volunteer type": { select: opts(TYPES) },
    "City": { select: opts(CITIES) },
    "Track(s) supported": { multi_select: opts(TRACKS) },
    "Preparedness": { select: opts(PREP) },
    "Preparedness score": { number: {} },
    "Overall experience": { select: opts(EXP) },
    "Experience score": { number: {} },
    "What worked well": { rich_text: {} },
    "Challenges": { rich_text: {} },
    "Improvements": { rich_text: {} },
    "Submitted": { date: {} },
    "Event": { rich_text: {} },
    "Event Date": { date: {} },
    "Ambassador page ID": { rich_text: {} },
  };

  await notion.databases.update({ database_id: DB_ID, properties: properties as never });
  // eslint-disable-next-line no-console
  console.log("Volunteer Feedback dev DB configured:", DB_ID);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: `package.json`** — add to `scripts`:
```json
    "setup:volunteer-feedback": "tsx --env-file=.env.local scripts/configure-volunteer-feedback-db.ts",
```

- [ ] **Step 3: `npm run typecheck`; expect no errors.** (Do NOT run the script here — the controller runs it against the live dev DB in Task 10.)
- [ ] **Step 4: Commit**
```bash
git add scripts/configure-volunteer-feedback-db.ts package.json
git commit -m "feat(scripts): configure dev volunteer-feedback DB properties"
```

---

## Task 8: Volunteer summary (pure)

**Files:** Create `lib/hub/volunteer-summary.ts`; Test `tests/volunteer-summary.test.ts`.

- [ ] **Step 1: Write the failing test `tests/volunteer-summary.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { volunteerSummary, type VolunteerRow } from "../lib/hub/volunteer-summary";

const rows: VolunteerRow[] = [
  { experience_score: 5, preparedness_score: 4, city: "New York" },
  { experience_score: 4, preparedness_score: 2, city: "New York" },
  { experience_score: null, preparedness_score: null, city: "San Francisco" },
];

describe("volunteerSummary", () => {
  it("counts responses and averages non-null scores", () => {
    const s = volunteerSummary(rows);
    expect(s.responses).toBe(3);
    expect(s.avgExperience).toBeCloseTo(4.5);
    expect(s.avgPreparedness).toBeCloseTo(3);
  });
  it("handles no responses", () => {
    const s = volunteerSummary([]);
    expect(s.responses).toBe(0);
    expect(s.avgExperience).toBeNull();
    expect(s.avgPreparedness).toBeNull();
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/volunteer-summary.test.ts`; expect FAIL.**

- [ ] **Step 3: Create `lib/hub/volunteer-summary.ts`:**
```ts
export interface VolunteerRow {
  experience_score: number | null;
  preparedness_score: number | null;
  city: string | null;
}
export interface VolunteerSummary {
  responses: number;
  avgExperience: number | null;
  avgPreparedness: number | null;
}
function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
export function volunteerSummary(rows: VolunteerRow[]): VolunteerSummary {
  return {
    responses: rows.length,
    avgExperience: avg(rows.map((r) => r.experience_score).filter((n): n is number => n != null)),
    avgPreparedness: avg(rows.map((r) => r.preparedness_score).filter((n): n is number => n != null)),
  };
}
```

- [ ] **Step 4: Run `npx vitest run tests/volunteer-summary.test.ts`; expect PASS (2 tests).**
- [ ] **Step 5: Commit**
```bash
git add lib/hub/volunteer-summary.ts tests/volunteer-summary.test.ts
git commit -m "feat(hub): pure volunteer summary (responses, avg experience/preparedness)"
```

---

## Task 9: `/volunteers` page + nav + auth

**Files:** Create `components/VolunteersTable.tsx`, `app/volunteers/page.tsx`; Modify `components/AppNav.tsx`, `middleware.ts`.

- [ ] **Step 1: `components/AppNav.tsx`** — add a Volunteers link to `LINKS` (between Feedback and Settings):
```tsx
  { href: "/feedback", label: "Feedback" },
  { href: "/volunteers", label: "Volunteers" },
  { href: "/settings/emails", label: "Settings" },
```

- [ ] **Step 2: `components/VolunteersTable.tsx`:**
```tsx
"use client";
import { useState } from "react";
import { EventTabs, type TabItem } from "./EventTabs";
import { volunteerSummary } from "@/lib/hub/volunteer-summary";
import type { VolunteerFeedbackRow } from "@/lib/db/volunteer-feedback";

export function VolunteersTable({
  rows, tabs, activeKey,
}: { rows: VolunteerFeedbackRow[]; tabs: TabItem[]; activeKey: string }) {
  const [q, setQ] = useState("");
  const scoped = rows.filter((r) => activeKey === "__all__" || r.luma_event_id === activeKey);
  const filtered = scoped.filter((r) => {
    if (!q.trim()) return true;
    const hay = [r.volunteer_name, r.city, r.event_name, r.what_worked, r.challenges, r.improvements, r.tracks?.join(" ")]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const s = volunteerSummary(scoped);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <EventTabs tabs={tabs} basePath="/volunteers" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, comment"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm" />
      </div>
      <div className="mb-4 flex gap-6 text-sm text-neutral-600">
        <span><b className="text-neutral-900">{s.responses}</b> responses</span>
        <span>Avg experience <b className="text-neutral-900">{s.avgExperience != null ? s.avgExperience.toFixed(1) : "—"}</b>/5</span>
        <span>Avg preparedness <b className="text-neutral-900">{s.avgPreparedness != null ? s.avgPreparedness.toFixed(1) : "—"}</b>/5</span>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No volunteer feedback yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50 text-left">
                {["Volunteer", "Type", "City", "Event", "Tracks", "Preparedness", "Overall", "What worked", "Challenges", "Improvements", "Submitted"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ambassador_page_id} className="border-b align-top hover:bg-neutral-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.volunteer_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.volunteer_type ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.city ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.event_name ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.tracks?.length ? r.tracks.join(", ") : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.preparedness_label ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.experience_label ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.what_worked ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.challenges ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs">{r.improvements ?? "—"}</td>
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

- [ ] **Step 3: `app/volunteers/page.tsx`:**
```tsx
import { AppNav } from "@/components/AppNav";
import { VolunteersTable } from "@/components/VolunteersTable";
import { listVolunteerFeedback } from "@/lib/db/volunteer-feedback";
import { eventSummaries } from "@/lib/db/dashboard";
import { eventLabel } from "@/lib/hub/format";
import type { TabItem } from "@/components/EventTabs";

export const dynamic = "force-dynamic";

export default async function VolunteersPage({ searchParams }: { searchParams: { event?: string } }) {
  const [rows, events] = await Promise.all([listVolunteerFeedback(), eventSummaries()]);
  const tabs: TabItem[] = [
    { key: "__all__", label: "All events" },
    ...events.map((e) => ({ key: e.luma_event_id, label: eventLabel(e.location, e.start_at, e.timezone) })),
  ];
  const activeKey = searchParams.event ?? "__all__";
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppNav />
      <p className="mb-4 text-sm text-neutral-500">Volunteer (ambassador / Notino / partner) feedback, mirrored from the Ambassador workspace.</p>
      <VolunteersTable rows={rows} tabs={tabs} activeKey={activeKey} />
    </div>
  );
}
```

- [ ] **Step 4: `middleware.ts`** — add `/volunteers` to the matcher:
```ts
  matcher: ["/", "/feedback", "/volunteers", "/settings/:path*"],
```
Also update the guarding comment to mention `/volunteers`.

- [ ] **Step 5: `npm run typecheck && npm run build`; expect success, `/volunteers` compiles.**
- [ ] **Step 6: Commit**
```bash
git add components/VolunteersTable.tsx app/volunteers/page.tsx components/AppNav.tsx middleware.ts
git commit -m "feat(volunteers): /volunteers hub page (tabs, search, summary, table) behind auth"
```

---

## Task 10: Env docs, full test, configure dev DB, deploy, first import

**Files:** Modify `.env.example`.

- [ ] **Step 1: `.env.example`** — under the Notion block add:
```
NOTION_AMBASSADOR_TOKEN=         # Notion integration token for the Ambassador prod workspace (volunteer feedback source)
NOTION_VOLUNTEER_PROD_DB_ID=     # Optional — override the ambassador volunteer-feedback DB id (default pinned)
NOTION_VOLUNTEER_DEV_DB_ID=      # Optional — override the dev volunteer-feedback mirror DB id (default pinned)
```

- [ ] **Step 2: Full suite** — `npm test`; expect all pass (existing + volunteer-feedback-notion + volunteer-summary).
- [ ] **Step 3: Build** — `npm run build`; expect success.
- [ ] **Step 4: Commit**
```bash
git add .env.example
git commit -m "docs(env): NOTION_AMBASSADOR_TOKEN + volunteer DB id overrides"
```

- [ ] **Step 5 (controller, live):** Build the dev DB properties — `npm run setup:volunteer-feedback`. Expect `Volunteer Feedback dev DB configured`. Verify in Notion (or re-probe) that the dev DB now has the VF_DEV properties.
- [ ] **Step 6 (controller, live):** Add `NOTION_AMBASSADOR_TOKEN` to Vercel prod env, then deploy — `npx vercel --prod --yes`.
- [ ] **Step 7 (controller, live):** Trigger first import —
```bash
SECRET=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")
curl -s -X POST https://notion-101.vercel.app/api/cron/volunteer-feedback-import -H "x-cron-secret: $SECRET"
```
Expected: `{"imported":0,...}` today (0 volunteer submissions yet); once real responses exist they appear in the dev DB and on `/volunteers`.
- [ ] **Step 8:** Confirm `/volunteers` requires login (HTTP 307 unauthenticated) like `/feedback`.

---

## Notes for the implementer
- `sql` binds a JS array to `text[]` natively — bind `${f.tracks}` directly (no cast).
- Dev writes use `parent: { database_id: VOLUNTEER_DEV_DB_ID }` (classic-shape DB, 2022-06-28 SDK) — same as `lib/notion/push.ts`.
- Reuse the existing pure `selectEventForFeedback` (`lib/events/feedback-match.ts`) — do NOT reimplement matching.
- Steps marked **(controller, live)** in Task 10 touch the live dev DB / prod / secrets — the controller runs those, not an implementer subagent.
- Reference originals: `/tmp/OfficeHours/lib/notion/feedback.ts` (`upsertMirrorRow`, `copyableProperties`), `scripts/configure-expert-feedback-db.ts`.
