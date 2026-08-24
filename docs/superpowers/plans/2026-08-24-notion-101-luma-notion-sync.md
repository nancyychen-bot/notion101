# Notion 101 — Luma ⇄ Notion Sync + Comms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link a single Notion guest database to a Luma event's guest list — approve/decline from Notion push to Luma, RSVPs flow into Notion in real time, and the system sends automatic emails (approval, decline, 3-day + 1-day reminders, post-event survey) plus a day-before auto-decline of stragglers.

**Architecture:** Stateless Next.js 14 (App Router, Node runtime) on Vercel. Neon Postgres is a thin mirror/dedup/audit layer. Luma is the RSVP source of truth; Notion is the human triage surface. Real-time Luma webhook writes guests into Notion; a Notion "Send webhook" automation pushes approve/decline back to Luma. Resend sends email; Vercel Cron drives reminders/survey/auto-decline. Only events registered through a signup page are processed.

**Tech Stack:** Next.js 14, TypeScript, Neon Postgres (`@neondatabase/serverless`), `@notionhq/client`, Luma public API, Resend, Vitest, Tailwind.

**Reference project (copy source):** `/Users/nchen/Library/Mobile Documents/com~apple~CloudDocs/Apps Created/office-hours` — referred to below as `REF/`. Spec: `docs/superpowers/specs/2026-08-24-notion-101-luma-notion-sync-design.md`.

**Conventions:**
- Commit after every task with the message shown.
- Run `npm run typecheck` before each commit; it must pass.
- All new modules use the injectable-deps pattern from REF so they're unit-testable.
- `git` identity for commits in this repo: `nancyychen-bot`.

---

## File Structure

```
lib/
  env.ts                      env access (lazy validation)
  db/{client,events,guests,email-log,sync-log}.ts   Neon query layer
  db/schema.sql               DDL (source of truth for the Neon schema)
  luma/{client,types,verify,parse}.ts               Luma API + webhook
  notion/{client,schema,mappers,push}.ts            Notion API + guest DB
  email/{resend,ics,templates,comms}.ts             Resend send + dedup
  events/{register,decline-pending,reminders,survey,dates,hash}.ts   domain logic
  auth/{session,form-token}.ts                       dashboard auth
app/
  layout.tsx, globals.css, page.tsx (dashboard), login/page.tsx, add-event/page.tsx
  api/health/route.ts
  api/webhooks/luma/route.ts
  api/webhooks/notion/route.ts
  api/cron/{decline-pending,reminders,survey,comms-retry,reconcile}/route.ts
  api/add-event/route.ts
  api/sync-now/route.ts
components/{AddEventForm,Dashboard}.tsx
scripts/{create-notion-database,register-event}.ts
tests/*.test.ts
```

---

## Phase 0 — Project scaffold

### Task 0.1: Scaffold Next.js + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "notion-101",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "setup:notion": "tsx --env-file=.env.local scripts/create-notion-database.ts",
    "register:event": "tsx --env-file=.env.local scripts/register-event.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "@notionhq/client": "^2.2.15",
    "next": "14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "resend": "^4.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/react": "^18.3.11",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Copy config files from REF**

Copy these verbatim from `REF/` (they are project-agnostic): `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`. Then in `next.config.mjs` confirm there is no `X-Frame-Options: DENY` header (we need Notion to iframe `/add-event`).

- [ ] **Step 3: Create `.gitignore`**

```
node_modules
.next
.env*.local
.vercel
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 4: Create minimal `app/layout.tsx`, `app/globals.css`, `app/page.tsx`**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`app/layout.tsx`:
```tsx
import "./globals.css";

export const metadata = { title: "Notion 101" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
```

`app/page.tsx` (placeholder — replaced by the dashboard in Phase 6):
```tsx
export default function Home() {
  return <main className="p-10">Notion 101 hub</main>;
}
```

- [ ] **Step 5: Install and verify build**

Run: `npm install && npm run typecheck && npm run build`
Expected: install succeeds; typecheck passes; build completes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "scaffold: init Next.js + Tailwind + Vitest for Notion 101"
```

### Task 0.2: Environment access layer

**Files:**
- Create: `lib/env.ts`, `.env.example`

- [ ] **Step 1: Create `lib/env.ts`**

Adapt from `REF/lib/env.ts` (same `required`/`optional` helpers). Replace the `supabase`, `notionAmbassador`, `slack` groups. Final contents:

```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  return value;
}
function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  db: { url: () => required("DATABASE_URL") },
  luma: {
    apiKey: () => required("LUMA_API_KEY"),
    webhookSecret: () => optional("LUMA_WEBHOOK_SECRET"),
  },
  notion: {
    token: () => required("NOTION_TOKEN"),
    guestsDataSourceId: () => required("NOTION_GUESTS_DATA_SOURCE_ID"),
    guestsDbId: () => optional("NOTION_GUESTS_DB_ID"),
    webhookSecret: () => optional("NOTION_WEBHOOK_SECRET"),
  },
  comms: {
    apiKey: () => required("RESEND_API_KEY"),
    from: () => required("COMMS_FROM"),
    replyTo: () => optional("COMMS_REPLY_TO"),
    enabled: () => optional("COMMS_ENABLED") !== "false",
  },
  app: {
    baseUrl: () => optional("APP_BASE_URL") ?? "http://localhost:3000",
    cronSecret: () => optional("CRON_SECRET"),
    surveyUrl: () => optional("SURVEY_URL"),
    freeTrialUrl: () => optional("FREE_TRIAL_URL") ?? "https://www.notion.so/product",
  },
  dashboard: {
    password: () => required("DASHBOARD_PASSWORD"),
    sessionSecret: () => required("SESSION_SECRET"),
  },
} as const;
```

- [ ] **Step 2: Create `.env.example`** mirroring §10 of the spec (all keys, no values).

- [ ] **Step 3: Commit**

```bash
git add lib/env.ts .env.example
git commit -m "feat: add env access layer + .env.example"
```

---

## Phase 1 — Neon Postgres data layer

### Task 1.1: DDL + DB client

**Files:**
- Create: `lib/db/schema.sql`, `lib/db/client.ts`

- [ ] **Step 1: Create `lib/db/schema.sql`** (exact tables from spec §4)

```sql
create extension if not exists "pgcrypto";

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  luma_event_id text unique not null,
  name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  public_url text,
  survey_url text,
  created_at timestamptz not null default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  luma_guest_id text unique not null,
  name text,
  email text,
  luma_status text not null default 'pending',
  checked_in_at timestamptz,
  answers jsonb,
  notion_page_id text,
  last_synced_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guests_event_idx on guests(event_id);
create index if not exists guests_notion_page_idx on guests(notion_page_id);

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guests(id) on delete cascade,
  kind text not null,
  recipient_email text not null,
  resend_id text,
  status text not null,
  created_at timestamptz not null default now(),
  unique (guest_id, kind, recipient_email)
);

create table if not exists sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text,
  action text,
  result text,
  guest_id uuid,
  note text,
  payload jsonb,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Create `lib/db/client.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { env } from "../env";

/** Tagged-template SQL client (HTTP). Reused across all query modules. */
export const sql = neon(env.db.url());
```

- [ ] **Step 3: Apply schema to Neon**

Run (after `DATABASE_URL` is in `.env.local`): `psql "$DATABASE_URL" -f lib/db/schema.sql`
Expected: `CREATE TABLE` etc. with no errors. (If `psql` unavailable, paste the SQL into the Neon SQL editor.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.sql lib/db/client.ts
git commit -m "feat: add Neon schema + sql client"
```

### Task 1.2: `sync-log` + `events` query modules

**Files:**
- Create: `lib/db/sync-log.ts`, `lib/db/events.ts`, `lib/events/dates.ts`
- Test: `tests/dates.test.ts`

- [ ] **Step 1: Create `lib/db/sync-log.ts`**

```ts
import { sql } from "./client";

export interface SyncLogEntry {
  direction?: string;
  action?: string;
  result?: string;
  guestId?: string | null;
  note?: string | null;
  payload?: unknown;
}

/** Best-effort audit write — never throws (logging must not break a flow). */
export async function logSync(e: SyncLogEntry): Promise<void> {
  try {
    await sql`
      insert into sync_log (direction, action, result, guest_id, note, payload)
      values (${e.direction ?? null}, ${e.action ?? null}, ${e.result ?? null},
              ${e.guestId ?? null}, ${e.note ?? null},
              ${e.payload ? JSON.stringify(e.payload) : null})
    `;
  } catch {
    /* swallow — audit only */
  }
}
```

- [ ] **Step 2: Write failing test `tests/dates.test.ts`** for the date helpers used by crons.

```ts
import { describe, it, expect } from "vitest";
import { isoDatePlusDays, isWithinDaysBefore } from "../lib/events/dates";

describe("date helpers", () => {
  it("isoDatePlusDays returns the UTC calendar date N days ahead", () => {
    expect(isoDatePlusDays(new Date("2026-08-24T13:00:00Z"), 1)).toBe("2026-08-25");
    expect(isoDatePlusDays(new Date("2026-08-24T13:00:00Z"), 3)).toBe("2026-08-27");
  });

  it("isWithinDaysBefore is true when the event date is exactly N days from now", () => {
    const now = new Date("2026-08-24T13:00:00Z");
    expect(isWithinDaysBefore("2026-08-27T18:00:00Z", now, 3)).toBe(true);
    expect(isWithinDaysBefore("2026-08-25T18:00:00Z", now, 1)).toBe(true);
    expect(isWithinDaysBefore("2026-08-26T18:00:00Z", now, 1)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dates.test.ts`
Expected: FAIL — module `../lib/events/dates` not found.

- [ ] **Step 4: Create `lib/events/dates.ts`**

```ts
/** UTC calendar date (YYYY-MM-DD) N days after `now`. */
export function isoDatePlusDays(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True if `eventStartIso` falls on the UTC calendar date exactly `days` ahead of `now`. */
export function isWithinDaysBefore(eventStartIso: string, now: Date, days: number): boolean {
  return eventStartIso.slice(0, 10) === isoDatePlusDays(now, days);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dates.test.ts`
Expected: PASS.

- [ ] **Step 6: Create `lib/db/events.ts`**

```ts
import { sql } from "./client";

export interface EventRow {
  id: string;
  luma_event_id: string;
  name: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  public_url: string | null;
  survey_url: string | null;
}

export async function upsertEvent(e: {
  lumaEventId: string; name?: string | null; startAt?: string | null;
  endAt?: string | null; timezone?: string | null; publicUrl?: string | null;
}): Promise<EventRow> {
  const rows = (await sql`
    insert into events (luma_event_id, name, start_at, end_at, timezone, public_url)
    values (${e.lumaEventId}, ${e.name ?? null}, ${e.startAt ?? null}, ${e.endAt ?? null},
            ${e.timezone ?? null}, ${e.publicUrl ?? null})
    on conflict (luma_event_id) do update set
      name = excluded.name, start_at = excluded.start_at, end_at = excluded.end_at,
      timezone = excluded.timezone, public_url = excluded.public_url
    returning *
  `) as EventRow[];
  return rows[0];
}

export async function getEventByLumaId(lumaEventId: string): Promise<EventRow | null> {
  const rows = (await sql`select * from events where luma_event_id = ${lumaEventId}`) as EventRow[];
  return rows[0] ?? null;
}

export async function getEventById(id: string): Promise<EventRow | null> {
  const rows = (await sql`select * from events where id = ${id}`) as EventRow[];
  return rows[0] ?? null;
}

export async function listEvents(): Promise<EventRow[]> {
  return (await sql`select * from events order by start_at desc nulls last`) as EventRow[];
}

/** Registered flag used by the Luma webhook to drop unregistered events. */
export async function isEventRegistered(lumaEventId: string): Promise<boolean> {
  return (await getEventByLumaId(lumaEventId)) !== null;
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/db/sync-log.ts lib/db/events.ts lib/events/dates.ts tests/dates.test.ts
git commit -m "feat: add sync-log, events query module, and date helpers"
```

### Task 1.3: `guests` + `email-log` query modules

**Files:**
- Create: `lib/db/guests.ts`, `lib/db/email-log.ts`

- [ ] **Step 1: Create `lib/db/guests.ts`**

```ts
import { sql } from "./client";

export interface GuestRow {
  id: string;
  event_id: string;
  luma_guest_id: string;
  name: string | null;
  email: string | null;
  luma_status: "pending" | "approved" | "declined" | "waitlist";
  checked_in_at: string | null;
  answers: Record<string, unknown> | null;
  notion_page_id: string | null;
  last_synced_hash: string | null;
}

export async function upsertGuest(g: {
  eventId: string; lumaGuestId: string; name?: string | null; email?: string | null;
  lumaStatus: GuestRow["luma_status"]; checkedInAt?: string | null; answers?: unknown;
}): Promise<GuestRow> {
  const rows = (await sql`
    insert into guests (event_id, luma_guest_id, name, email, luma_status, checked_in_at, answers, updated_at)
    values (${g.eventId}, ${g.lumaGuestId}, ${g.name ?? null}, ${g.email ?? null},
            ${g.lumaStatus}, ${g.checkedInAt ?? null},
            ${g.answers ? JSON.stringify(g.answers) : null}, now())
    on conflict (luma_guest_id) do update set
      name = excluded.name, email = excluded.email, luma_status = excluded.luma_status,
      checked_in_at = coalesce(excluded.checked_in_at, guests.checked_in_at),
      answers = coalesce(excluded.answers, guests.answers), updated_at = now()
    returning *
  `) as GuestRow[];
  return rows[0];
}

export async function getGuestByLumaId(lumaGuestId: string): Promise<GuestRow | null> {
  const rows = (await sql`select * from guests where luma_guest_id = ${lumaGuestId}`) as GuestRow[];
  return rows[0] ?? null;
}

export async function getGuestByNotionPageId(pageId: string): Promise<GuestRow | null> {
  const rows = (await sql`select * from guests where notion_page_id = ${pageId}`) as GuestRow[];
  return rows[0] ?? null;
}

export async function getGuestById(id: string): Promise<GuestRow | null> {
  const rows = (await sql`select * from guests where id = ${id}`) as GuestRow[];
  return rows[0] ?? null;
}

export async function setLumaStatus(id: string, status: GuestRow["luma_status"]): Promise<GuestRow | null> {
  const rows = (await sql`
    update guests set luma_status = ${status}, updated_at = now() where id = ${id} returning *
  `) as GuestRow[];
  return rows[0] ?? null;
}

export async function setNotionPageId(id: string, pageId: string): Promise<void> {
  await sql`update guests set notion_page_id = ${pageId}, updated_at = now() where id = ${id}`;
}

export async function setSyncedHash(id: string, hash: string): Promise<void> {
  await sql`update guests set last_synced_hash = ${hash}, updated_at = now() where id = ${id}`;
}

export async function listGuestsForEvent(eventId: string): Promise<GuestRow[]> {
  return (await sql`select * from guests where event_id = ${eventId} order by created_at`) as GuestRow[];
}

export async function listApprovedForEvent(eventId: string): Promise<GuestRow[]> {
  return (await sql`
    select * from guests where event_id = ${eventId} and luma_status = 'approved'
  `) as GuestRow[];
}

export async function listCheckedInForEvent(eventId: string): Promise<GuestRow[]> {
  return (await sql`
    select * from guests where event_id = ${eventId} and checked_in_at is not null
  `) as GuestRow[];
}
```

- [ ] **Step 2: Create `lib/db/email-log.ts`** (idempotency: reserve → finalize, keyed on the unique constraint)

```ts
import { sql } from "./client";

export type CommsStatus = "sent" | "failed" | "skipped";

/**
 * Atomically claim the send slot for (guest, kind, email). Returns true only for
 * the winner. A prior `sent`/`skipped` row means already handled → false. A prior
 * `failed` row is reclaimable (retry) → true.
 */
export async function reserveCommsSlot(
  guestId: string, kind: string, email: string,
): Promise<boolean> {
  const rows = (await sql`
    insert into email_log (guest_id, kind, recipient_email, status)
    values (${guestId}, ${kind}, ${email}, 'reserved')
    on conflict (guest_id, kind, recipient_email) do update
      set status = 'reserved'
      where email_log.status = 'failed'
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function finalizeComms(
  guestId: string, kind: string, email: string,
  outcome: { resendId: string | null; status: CommsStatus },
): Promise<void> {
  await sql`
    update email_log set status = ${outcome.status}, resend_id = ${outcome.resendId}
    where guest_id = ${guestId} and kind = ${kind} and recipient_email = ${email}
  `;
}

export async function listFailed(limit = 100): Promise<
  { guest_id: string; kind: string; recipient_email: string }[]
> {
  return (await sql`
    select guest_id, kind, recipient_email from email_log
    where status = 'failed' order by created_at limit ${limit}
  `) as { guest_id: string; kind: string; recipient_email: string }[];
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db/guests.ts lib/db/email-log.ts
git commit -m "feat: add guests + email-log query modules"
```

---

## Phase 2 — Luma integration

### Task 2.1: Luma types + client (copy-adapt)

**Files:**
- Create: `lib/luma/types.ts`, `lib/luma/client.ts`

- [ ] **Step 1: Copy `REF/lib/luma/types.ts` → `lib/luma/types.ts`** verbatim. Keep `LumaEventDetail`, `LumaRegistrationQuestion`, `LumaGuestListEntry`, `LumaGuestListResponse`. Remove any slot-specific types if present.

- [ ] **Step 2: Copy `REF/lib/luma/client.ts` → `lib/luma/client.ts`** and adapt:
  - Replace `import ... env from "../env"` usage of `env.luma.apiKey()` — already matches our env shape.
  - Replace the `LumaStatus` import: define a local type instead of `../sync/types`:
    ```ts
    export type LumaStatus = "pending" | "approved" | "declined" | "waitlist";
    ```
  - Keep `parseLumaEventId`, `resolveLumaEventId`, `listEventGuests`, `fetchEventStats`, `getLumaEvent`, `extractSlotOptions` (rename to `extractQuestionOptions` — it works for any select question), `updateGuestStatus`.
  - In `updateGuestStatus`, change the `send_email` line so **we always own guest email** (custom approval + decline emails):
    ```ts
    // We send our own approval/decline emails via Resend, so never let Luma email.
    send_email: false,
    ```
  - Confirm `LUMA_API_STATUS` maps `pending → "pending_approval"`.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/luma/types.ts lib/luma/client.ts
git commit -m "feat: add Luma API client (approve/decline, guest list, event detail)"
```

### Task 2.2: Luma webhook verify + parse

**Files:**
- Create: `lib/luma/verify.ts`, `lib/luma/parse.ts`
- Test: `tests/luma-parse.test.ts`, `tests/luma-verify.test.ts`

- [ ] **Step 1: Copy `REF/lib/luma/verify.ts` → `lib/luma/verify.ts`** verbatim (HMAC verification against `LUMA_WEBHOOK_SECRET`). Copy `REF/tests/*luma*verify*` test → `tests/luma-verify.test.ts`, fixing import paths.

- [ ] **Step 2: Run the copied verify test**

Run: `npx vitest run tests/luma-verify.test.ts`
Expected: PASS.

- [ ] **Step 3: Write failing test `tests/luma-parse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseGuestWebhook } from "../lib/luma/parse";

const payload = {
  type: "guest.updated",
  event: { api_id: "evt-abc" },
  guest: {
    api_id: "gst-123",
    name: "Ada Lovelace",
    email: "ada@example.com",
    approval_status: "pending_approval",
    checked_in_at: null,
    registration_answers: [
      { question_id: "q-company", answer: "Analytical Engines Inc" },
      { question_id: "q-size", answer: "10-50" },
    ],
  },
};

describe("parseGuestWebhook", () => {
  it("normalizes a guest.updated payload", () => {
    const g = parseGuestWebhook(payload);
    expect(g).toEqual({
      type: "guest.updated",
      lumaEventId: "evt-abc",
      lumaGuestId: "gst-123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      lumaStatus: "pending",
      checkedInAt: null,
      answers: { "q-company": "Analytical Engines Inc", "q-size": "10-50" },
    });
  });

  it("maps approval_status variants to hub statuses", () => {
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "approved" } }).lumaStatus).toBe("approved");
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "declined" } }).lumaStatus).toBe("declined");
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "waitlist" } }).lumaStatus).toBe("waitlist");
  });

  it("returns null when there is no guest", () => {
    expect(parseGuestWebhook({ type: "ping" })).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/luma-parse.test.ts`
Expected: FAIL — `../lib/luma/parse` not found.

- [ ] **Step 5: Create `lib/luma/parse.ts`**

```ts
import type { LumaStatus } from "./client";

export interface ParsedGuest {
  type: string;
  lumaEventId: string;
  lumaGuestId: string;
  name: string | null;
  email: string | null;
  lumaStatus: LumaStatus;
  checkedInAt: string | null;
  answers: Record<string, string>;
}

function toStatus(approval: string | null | undefined): LumaStatus {
  switch (approval) {
    case "approved": return "approved";
    case "declined": return "declined";
    case "waitlist": return "waitlist";
    default: return "pending"; // incl. "pending_approval"
  }
}

/** Normalize a Luma guest webhook. Returns null if it carries no guest. */
export function parseGuestWebhook(body: unknown): ParsedGuest | null {
  const b = body as {
    type?: string;
    event?: { api_id?: string };
    guest?: {
      api_id?: string; name?: string; email?: string;
      approval_status?: string; checked_in_at?: string | null;
      registration_answers?: { question_id?: string; answer?: unknown }[];
    };
  };
  const guest = b.guest;
  if (!guest?.api_id) return null;
  const answers: Record<string, string> = {};
  for (const a of guest.registration_answers ?? []) {
    if (a.question_id != null) answers[a.question_id] = String(a.answer ?? "");
  }
  return {
    type: b.type ?? "unknown",
    lumaEventId: b.event?.api_id ?? "",
    lumaGuestId: guest.api_id,
    name: guest.name ?? null,
    email: guest.email ?? null,
    lumaStatus: toStatus(guest.approval_status),
    checkedInAt: guest.checked_in_at ?? null,
    answers,
  };
}
```

> During live validation, confirm the real payload's field names (`registration_answers`, `question_id`, `answer`, `checked_in_at`) against a captured webhook (the Notion webhook route logs raw bodies; add the same raw-body log here) and adjust the parser if Luma differs.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/luma-parse.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/luma/verify.ts lib/luma/parse.ts tests/luma-parse.test.ts tests/luma-verify.test.ts
git commit -m "feat: add Luma webhook HMAC verify + payload parser"
```

---

## Phase 3 — Notion integration

### Task 3.1: Notion client + schema/question map + hash

**Files:**
- Create: `lib/notion/client.ts`, `lib/notion/schema.ts`, `lib/events/hash.ts`
- Test: `tests/hash.test.ts`

- [ ] **Step 1: Create `lib/notion/client.ts`**

```ts
import { Client } from "@notionhq/client";
import { env } from "../env";

let client: Client | null = null;
export function getNotionClient(): Client {
  if (!client) client = new Client({ auth: env.notion.token() });
  return client;
}
```

- [ ] **Step 2: Create `lib/notion/schema.ts`** — property names + the question-id→property map (pinned at setup; see §5).

```ts
/** Notion guest DB property names (must match the DB the setup script creates). */
export const PROP = {
  name: "Name",
  email: "Email",
  status: "Status",
  checkedIn: "Checked In",
  event: "Event",
  registeredAt: "Registered At",
  company: "Company",
  jobTitle: "Job Title",
  companySize: "Company Size",
  businessTrack: "Business Track",
  notionAccountEmail: "Notion Account Email",
  notionPlan: "Notion Plan",
  notionExperience: "Notion Experience",
  whyAttending: "Why Attending",
  notes: "Notes",
  lumaGuestId: "Luma Guest ID",
  lumaEventId: "Luma Event ID",
} as const;

/** Status select ↔ hub status. Notion is Title Case; the hub is lower-case. */
export const STATUS_TO_NOTION: Record<string, string> = {
  pending: "Pending", approved: "Approved", declined: "Declined", waitlist: "Waitlist",
};
export const NOTION_TO_STATUS: Record<string, "pending" | "approved" | "declined" | "waitlist"> = {
  Pending: "pending", Approved: "approved", Declined: "declined", Waitlist: "waitlist",
};

/**
 * Maps a Luma registration `question_id` → Notion property + how to render it.
 * Populated at setup time by scripts/create-notion-database.ts (written to
 * QUESTION_MAP.json). Loaded here so mappers/push stay pure. `kind` drives the
 * Notion property type used when writing the answer.
 */
export interface QuestionMapEntry {
  prop: string;
  kind: "rich_text" | "select" | "multi_select" | "email";
}
export type QuestionMap = Record<string, QuestionMapEntry>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
import questionMapJson from "./QUESTION_MAP.json";
export const QUESTION_MAP = questionMapJson as QuestionMap;
```

> The setup script (Task 7.1) writes `lib/notion/QUESTION_MAP.json`. Create a placeholder now so typecheck passes: `echo '{}' > lib/notion/QUESTION_MAP.json`.

- [ ] **Step 3: Write failing test `tests/hash.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { syncedFieldsHash, isEcho } from "../lib/events/hash";

describe("echo hash", () => {
  it("same synced fields → same hash", () => {
    const a = syncedFieldsHash({ status: "approved", name: "Ada", email: "a@x.com" });
    const b = syncedFieldsHash({ email: "a@x.com", name: "Ada", status: "approved" });
    expect(a).toBe(b);
  });
  it("changed field → different hash, and isEcho reflects it", () => {
    const base = { status: "approved", name: "Ada", email: "a@x.com" };
    const h = syncedFieldsHash(base);
    expect(isEcho(base, h)).toBe(true);
    expect(isEcho({ ...base, status: "declined" }, h)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/hash.test.ts`
Expected: FAIL — `../lib/events/hash` not found.

- [ ] **Step 5: Create `lib/events/hash.ts`**

```ts
import { createHash } from "node:crypto";

/** Deterministic hash over the fields the hub mirrors (order-independent). */
export function syncedFieldsHash(fields: Record<string, unknown>): string {
  const norm = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ""}`)
    .join("|");
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** True if `incoming` matches the last hash we wrote (an echo of our own write). */
export function isEcho(incoming: Record<string, unknown>, lastHash: string | null): boolean {
  if (!lastHash) return false;
  return syncedFieldsHash(incoming) === lastHash;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/hash.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/notion/client.ts lib/notion/schema.ts lib/notion/QUESTION_MAP.json lib/events/hash.ts tests/hash.test.ts
git commit -m "feat: add Notion client, guest-DB schema map, echo hash"
```

### Task 3.2: Notion mappers (answers → properties, page → status)

**Files:**
- Create: `lib/notion/mappers.ts`
- Test: `tests/notion-mappers.test.ts`

- [ ] **Step 1: Write failing test `tests/notion-mappers.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { answersToProperties, readStatusFromPage } from "../lib/notion/mappers";

const qmap = {
  "q-company": { prop: "Company", kind: "rich_text" as const },
  "q-size": { prop: "Company Size", kind: "select" as const },
  "q-why": { prop: "Why Attending", kind: "multi_select" as const },
};

describe("answersToProperties", () => {
  it("builds Notion property values by question kind", () => {
    const props = answersToProperties(
      { "q-company": "Acme", "q-size": "10-50", "q-why": "Learn basics, Organize business" },
      qmap,
    );
    expect(props["Company"]).toEqual({ rich_text: [{ text: { content: "Acme" } }] });
    expect(props["Company Size"]).toEqual({ select: { name: "10-50" } });
    expect(props["Why Attending"]).toEqual({
      multi_select: [{ name: "Learn basics" }, { name: "Organize business" }],
    });
  });
  it("skips unknown question ids and empty answers", () => {
    const props = answersToProperties({ "q-unknown": "x", "q-company": "" }, qmap);
    expect(props).toEqual({});
  });
});

describe("readStatusFromPage", () => {
  it("reads the Status select and lowercases it", () => {
    const page = { properties: { Status: { type: "select", select: { name: "Approved" } } } };
    expect(readStatusFromPage(page)).toBe("approved");
  });
  it("returns null when Status is empty", () => {
    const page = { properties: { Status: { type: "select", select: null } } };
    expect(readStatusFromPage(page)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/notion/mappers.ts`**

```ts
import { NOTION_TO_STATUS, type QuestionMap } from "./schema";

type PropValue = Record<string, unknown>;

/** Build Notion property values from raw Luma answers using the question map. */
export function answersToProperties(
  answers: Record<string, string>,
  qmap: QuestionMap,
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [qid, raw] of Object.entries(answers)) {
    const entry = qmap[qid];
    const value = (raw ?? "").trim();
    if (!entry || !value) continue;
    switch (entry.kind) {
      case "rich_text":
        out[entry.prop] = { rich_text: [{ text: { content: value } }] };
        break;
      case "email":
        out[entry.prop] = { email: value };
        break;
      case "select":
        out[entry.prop] = { select: { name: value } };
        break;
      case "multi_select":
        out[entry.prop] = {
          multi_select: value.split(",").map((s) => ({ name: s.trim() })).filter((o) => o.name),
        };
        break;
    }
  }
  return out;
}

/** Read the Status select from a retrieved page → hub status (lower-case) or null. */
export function readStatusFromPage(page: {
  properties?: Record<string, { type?: string; select?: { name?: string } | null }>;
}): "pending" | "approved" | "declined" | "waitlist" | null {
  const sel = page.properties?.Status;
  const name = sel?.select?.name;
  if (!name) return null;
  return NOTION_TO_STATUS[name] ?? null;
}
```

> Multi-select round-trips as a comma-joined string in Neon `answers`; if the real Luma payload sends arrays, adjust the parser (Task 2.2) to `join(", ")` before storing so this split stays correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/mappers.ts tests/notion-mappers.test.ts
git commit -m "feat: add Notion answer→property + status mappers"
```

### Task 3.3: Notion push (create/update guest page + hash stamp)

**Files:**
- Create: `lib/notion/push.ts`

- [ ] **Step 1: Create `lib/notion/push.ts`**

```ts
import { getNotionClient } from "./client";
import { PROP, STATUS_TO_NOTION, QUESTION_MAP } from "./schema";
import { answersToProperties } from "./mappers";
import { syncedFieldsHash } from "../events/hash";
import { setNotionPageId, setSyncedHash, type GuestRow } from "../db/guests";
import { env } from "../env";

function richText(v: string) { return { rich_text: [{ text: { content: v } }] }; }
function title(v: string) { return { title: [{ text: { content: v } }] }; }

/** The fields we mirror to Notion — also the echo-hash input. */
function syncedFields(g: GuestRow) {
  return { name: g.name ?? "", email: g.email ?? "", status: g.luma_status };
}

/**
 * Create (or update) the Notion row for a guest and stamp the echo hash.
 * `eventName` labels the Event column. Best-effort answer mapping via QUESTION_MAP.
 */
export async function pushGuestToNotion(g: GuestRow, eventName: string | null): Promise<void> {
  const notion = getNotionClient();
  const answerProps = answersToProperties((g.answers as Record<string, string>) ?? {}, QUESTION_MAP);
  const props: Record<string, unknown> = {
    [PROP.name]: title(g.name ?? g.email ?? "Guest"),
    [PROP.status]: { select: { name: STATUS_TO_NOTION[g.luma_status] } },
    [PROP.event]: richText(eventName ?? ""),
    [PROP.lumaGuestId]: richText(g.luma_guest_id),
    [PROP.lumaEventId]: richText(g.event_id),
    ...(g.email ? { [PROP.email]: { email: g.email } } : {}),
    ...(g.checked_in_at ? { [PROP.checkedIn]: { date: { start: g.checked_in_at } } } : {}),
    ...answerProps,
  };

  if (g.notion_page_id) {
    await notion.pages.update({ page_id: g.notion_page_id, properties: props as never });
  } else {
    const created = await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: env.notion.guestsDataSourceId() } as never,
      properties: props as never,
    });
    await setNotionPageId(g.id, created.id);
  }
  await setSyncedHash(g.id, syncedFieldsHash(syncedFields(g)));
}
```

> The `parent` uses the data-source id (Notion API v2025-09-03+), matching REF's write path. If the installed `@notionhq/client` predates data sources, use `parent: { database_id: env.notion.guestsDbId() }` instead — decide during setup against the live API version.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/notion/push.ts
git commit -m "feat: add Notion guest push (create/update + echo-hash stamp)"
```

---

## Phase 4 — Email (Resend + templates + comms)

### Task 4.1: Resend send + ICS (copy-adapt)

**Files:**
- Create: `lib/email/resend.ts`, `lib/email/ics.ts`

- [ ] **Step 1: Copy `REF/lib/email/resend.ts` → `lib/email/resend.ts`** verbatim (env shape matches: `env.comms.*`).

- [ ] **Step 2: Copy `REF/lib/email/ics.ts` → `lib/email/ics.ts`** and adapt: keep `buildInvite`, `inviteAttachment`, `fromAddressEmail`. Simplify the invite to a single event (no per-slot times/helper) — the invite uses the event's `start_at`/`end_at`, `name`, `public_url`/location. Remove `buildCancel` if unused (we only attach an invite on approval).

- [ ] **Step 3: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/email/resend.ts lib/email/ics.ts
git commit -m "feat: add Resend sender + event ICS invite"
```

### Task 4.2: Email templates

**Files:**
- Create: `lib/email/templates.ts`
- Test: `tests/email-templates.test.ts`

- [ ] **Step 1: Write failing test `tests/email-templates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderEmail, type EmailKind, type EmailFields } from "../lib/email/templates";

const fields: EmailFields = {
  guestName: "Ada Lovelace",
  eventName: "Notion 101 — NYC",
  eventDate: "Wednesday, August 26",
  location: "Notion HQ",
  surveyUrl: "https://survey.example.com/x",
  freeTrialUrl: "https://www.notion.so/product",
  eventUrl: "https://luma.com/notion101",
};

const kinds: EmailKind[] = ["approved", "decline", "reminder_3d", "reminder_1d", "survey"];

describe("renderEmail", () => {
  it.each(kinds)("renders %s with non-empty subject/html/text", (kind) => {
    const r = renderEmail(kind, fields);
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text).toContain("Ada"); // greets by first name
  });
  it("reminders include the free-trial CTA link", () => {
    for (const k of ["reminder_3d", "reminder_1d"] as EmailKind[]) {
      expect(renderEmail(k, fields).html).toContain(fields.freeTrialUrl);
    }
  });
  it("survey includes the survey link", () => {
    expect(renderEmail("survey", fields).html).toContain(fields.surveyUrl!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/email/templates.ts`**

```ts
export type EmailKind = "approved" | "decline" | "reminder_3d" | "reminder_1d" | "survey";

export interface EmailFields {
  guestName: string | null;
  eventName: string | null;
  eventDate?: string | null;
  location?: string | null;
  surveyUrl?: string | null;
  freeTrialUrl: string;
  eventUrl?: string | null;
}

export interface RenderedEmail { subject: string; html: string; text: string; }

const SIGNOFF = "The Notion Community Team";
const firstName = (n: string | null) => (n ?? "there").trim().split(/\s+/)[0] || "there";
const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
const wrap = (body: string) =>
  `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${body}</div>`;
const btn = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;
const details = (f: EmailFields) =>
  [f.eventDate ? `🗓  ${f.eventDate}` : null, f.location ? `📍  ${f.location}` : null]
    .filter(Boolean).join("<br>");

export function renderEmail(kind: EmailKind, f: EmailFields): RenderedEmail {
  const fn = firstName(f.guestName);
  const ev = f.eventName ?? "Notion 101";
  const trial = `Come early to Notion? ${"You can start a free Notion trial here"} — <a href="${f.freeTrialUrl}">${f.freeTrialUrl}</a>.`;

  switch (kind) {
    case "approved": {
      const subject = `You're in — ${ev} 🎉`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Great news — you're approved for <strong>${ev}</strong>. We can't wait to build with you!`) +
        (details(f) ? p(details(f)) : "") +
        p(`A calendar invite is attached so the time is locked in.`) +
        (f.eventUrl ? p(`Event page: <a href="${f.eventUrl}">${f.eventUrl}</a>`) : "") +
        p(trial) +
        p(`See you soon,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nYou're approved for ${ev}. We can't wait to build with you!\n` +
        `${f.eventDate ?? ""} ${f.location ?? ""}\n\nA calendar invite is attached.\n` +
        `Start a free Notion trial: ${f.freeTrialUrl}\n\nSee you soon,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "decline": {
      const subject = `An update on your ${ev} registration`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Thanks so much for your interest in <strong>${ev}</strong>. Unfortunately we weren't able to confirm you a spot this time — these sessions fill up fast.`) +
        p(`We'd love to see you at a future event. In the meantime, you can keep building: <a href="${f.freeTrialUrl}">start a free Notion trial</a>.`) +
        p(`Thanks,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nThanks for your interest in ${ev}. Unfortunately we couldn't confirm you a spot this time.\n` +
        `We'd love to see you at a future event. Start a free Notion trial: ${f.freeTrialUrl}\n\nThanks,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "reminder_3d":
    case "reminder_1d": {
      const when = kind === "reminder_3d" ? "in 3 days" : "tomorrow";
      const subject = `${ev} is ${when} — see you there!`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Quick reminder that <strong>${ev}</strong> is ${when}.`) +
        (details(f) ? p(details(f)) : "") +
        (f.eventUrl ? btn(f.eventUrl, "View event details") : "") +
        p(`New to Notion? ${trial}`) +
        p(`See you soon,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nReminder: ${ev} is ${when}.\n${f.eventDate ?? ""} ${f.location ?? ""}\n` +
        `${f.eventUrl ? `Details: ${f.eventUrl}\n` : ""}Start a free Notion trial: ${f.freeTrialUrl}\n\nSee you soon,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "survey": {
      const subject = `Thanks for coming to ${ev} — 2 quick questions`;
      const url = f.surveyUrl ?? f.freeTrialUrl;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Thanks for joining us at <strong>${ev}</strong>! We'd love your feedback — it takes under two minutes.`) +
        btn(url, "Share your feedback") +
        p(`Thanks again,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nThanks for joining ${ev}! Please share quick feedback: ${url}\n\nThanks again,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/email-templates.test.ts
git commit -m "feat: add email templates (approve/decline/reminders/survey)"
```

### Task 4.3: Comms orchestrator (dedup + attach ICS on approval)

**Files:**
- Create: `lib/email/comms.ts`

- [ ] **Step 1: Create `lib/email/comms.ts`** — thin orchestrator over the query layer + Resend (adapted from REF `comms.ts`, single-recipient guest model).

```ts
import { getGuestById } from "../db/guests";
import { getEventById } from "../db/events";
import { reserveCommsSlot, finalizeComms } from "../db/email-log";
import { sendEmail } from "./resend";
import { buildInvite, inviteAttachment, fromAddressEmail } from "./ics";
import { renderEmail, type EmailKind, type EmailFields } from "./templates";
import { logSync } from "../db/sync-log";
import { env } from "../env";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
    });
  } catch { return null; }
}

/**
 * Send one email to a guest for `kind`. Idempotent via email_log (guest,kind,email).
 * Best-effort: never throws. Attaches an event .ics on `approved`.
 */
export async function sendGuestEmail(guestId: string, kind: EmailKind): Promise<void> {
  try {
    const g = await getGuestById(guestId);
    if (!g?.email) return;
    const ev = await getEventById(g.event_id);
    const fields: EmailFields = {
      guestName: g.name,
      eventName: ev?.name ?? null,
      eventDate: formatDate(ev?.start_at ?? null),
      location: null,
      surveyUrl: ev?.survey_url ?? env.app.surveyUrl() ?? null,
      freeTrialUrl: env.app.freeTrialUrl(),
      eventUrl: ev?.public_url ?? null,
    };
    const rendered = renderEmail(kind, fields);

    let attachments;
    if (kind === "approved" && ev?.start_at) {
      const ics = buildInvite(
        {
          uid: `${g.id}@notion101`,
          summary: ev.name ?? "Notion 101",
          startsAt: ev.start_at,
          endsAt: ev.end_at,
          location: ev.public_url,
          description: rendered.text,
          attendeeEmail: g.email,
        },
        fromAddressEmail(env.comms.from()),
        new Date().toISOString(),
      );
      if (ics) attachments = [inviteAttachment(ics, "PUBLISH")];
    }

    if (!(await reserveCommsSlot(g.id, kind, g.email))) return;
    if (!env.comms.enabled()) {
      await finalizeComms(g.id, kind, g.email, { resendId: null, status: "skipped" });
      return;
    }
    try {
      const { id } = await sendEmail({
        to: g.email, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments,
      });
      if (!id) throw new Error("Resend returned no id");
      await finalizeComms(g.id, kind, g.email, { resendId: id, status: "sent" });
    } catch (err) {
      await finalizeComms(g.id, kind, g.email, { resendId: null, status: "failed" });
      await logSync({ direction: "cron", result: "error", guestId: g.id, action: `email_${kind}`, note: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    await logSync({ direction: "cron", result: "error", guestId, action: `email_${kind}`, note: err instanceof Error ? err.message : String(err) });
  }
}
```

> Align the `buildInvite` field names above with the actual signature you kept in Task 4.1's `ics.ts`. If REF's `buildInvite` takes a different shape, adapt this call site to match (keep the shape defined here as the target if you rewrite ics.ts).

- [ ] **Step 2: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/email/comms.ts
git commit -m "feat: add comms orchestrator (dedup send + approval ICS)"
```

---

## Phase 5 — Domain logic (status apply, register, crons)

### Task 5.1: Apply-status (Notion/cron → Luma + email + mirror)

**Files:**
- Create: `lib/events/apply-status.ts`
- Test: `tests/apply-status.test.ts`

- [ ] **Step 1: Write failing test `tests/apply-status.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { applyStatus } from "../lib/events/apply-status";
import type { GuestRow } from "../lib/db/guests";

const guest: GuestRow = {
  id: "g1", event_id: "e1", luma_guest_id: "gst-1", name: "Ada", email: "a@x.com",
  luma_status: "pending", checked_in_at: null, answers: null, notion_page_id: "pg1", last_synced_hash: null,
};

function deps() {
  return {
    setLumaStatus: vi.fn(async (_id: string, s: GuestRow["luma_status"]) => ({ ...guest, luma_status: s })),
    updateGuestOnLuma: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    pushToNotion: vi.fn(async () => {}),
    getEventLumaId: vi.fn(async () => "evt-1"),
    log: vi.fn(async () => {}),
  };
}

describe("applyStatus", () => {
  it("approve: writes Luma, sends approval email, mirrors to Notion", async () => {
    const d = deps();
    await applyStatus(guest, "approved", d);
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "approved");
    expect(d.sendEmail).toHaveBeenCalledWith("g1", "approved");
    expect(d.setLumaStatus).toHaveBeenCalledWith("g1", "approved");
    expect(d.pushToNotion).toHaveBeenCalled();
  });
  it("decline: sends decline email", async () => {
    const d = deps();
    await applyStatus(guest, "declined", d);
    expect(d.sendEmail).toHaveBeenCalledWith("g1", "decline");
  });
  it("no-op when status unchanged", async () => {
    const d = deps();
    await applyStatus({ ...guest, luma_status: "approved" }, "approved", d);
    expect(d.updateGuestOnLuma).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/apply-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/events/apply-status.ts`**

```ts
import type { GuestRow } from "../db/guests";
import type { LumaStatus } from "../luma/client";
import type { EmailKind } from "../email/templates";

export interface ApplyStatusDeps {
  setLumaStatus: (id: string, s: LumaStatus) => Promise<GuestRow | null>;
  updateGuestOnLuma: (eventLumaId: string, guestLumaId: string, s: LumaStatus) => Promise<void>;
  sendEmail: (guestId: string, kind: EmailKind) => Promise<void>;
  pushToNotion: (g: GuestRow) => Promise<void>;
  getEventLumaId: (eventId: string) => Promise<string | null>;
  log: (e: { action: string; note?: string; error?: boolean }) => Promise<void>;
}

/** Email kind to send for a status transition (none for waitlist/pending). */
const EMAIL_FOR: Partial<Record<LumaStatus, EmailKind>> = {
  approved: "approved",
  declined: "decline",
};

/**
 * Apply a status change originating in Notion or a cron: push to Luma, persist,
 * send the guest email, and mirror the canonical state back to Notion. Best-effort.
 */
export async function applyStatus(
  guest: GuestRow, next: LumaStatus, deps: ApplyStatusDeps,
): Promise<void> {
  if (guest.luma_status === next) return;

  const eventLumaId = await deps.getEventLumaId(guest.event_id);
  if (eventLumaId) {
    try {
      await deps.updateGuestOnLuma(eventLumaId, guest.luma_guest_id, next);
    } catch (err) {
      await deps.log({ action: `luma_update:${next}`, note: err instanceof Error ? err.message : String(err), error: true });
    }
  }
  const updated = (await deps.setLumaStatus(guest.id, next)) ?? { ...guest, luma_status: next };

  const kind = EMAIL_FOR[next];
  if (kind) await deps.sendEmail(updated.id, kind);

  await deps.pushToNotion(updated);
  await deps.log({ action: `status:${next}` });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/apply-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the default-deps wiring** at the bottom of `apply-status.ts` (used by routes/crons):

```ts
import { setLumaStatus } from "../db/guests";
import { getEventById } from "../db/events";
import { updateGuestStatus } from "../luma/client";
import { sendGuestEmail } from "../email/comms";
import { pushGuestToNotion } from "../notion/push";
import { logSync } from "../db/sync-log";

export function defaultApplyDeps(direction: string, guestId: string): ApplyStatusDeps {
  return {
    setLumaStatus,
    updateGuestOnLuma: (eventLumaId, guestLumaId, s) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: s }),
    sendEmail: (id, kind) => sendGuestEmail(id, kind),
    pushToNotion: async (g) => {
      const ev = await getEventById(g.event_id);
      await pushGuestToNotion(g, ev?.name ?? null);
    },
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: (e) => logSync({ direction, result: e.error ? "error" : "applied", guestId, action: e.action, note: e.note }),
  };
}
```

- [ ] **Step 6: Run full test suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/events/apply-status.ts tests/apply-status.test.ts
git commit -m "feat: add apply-status (Luma push + email + Notion mirror)"
```

### Task 5.2: Event registration + backfill

**Files:**
- Create: `lib/events/register.ts`

- [ ] **Step 1: Create `lib/events/register.ts`**

```ts
import { resolveLumaEventId, getLumaEvent, listEventGuests } from "../luma/client";
import { upsertEvent, getEventByLumaId } from "../db/events";
import { upsertGuest } from "../db/guests";
import { pushGuestToNotion } from "../notion/push";
import { logSync } from "../db/sync-log";

export interface RegisterResult { eventName: string; lumaEventId: string; guestsImported: number; }

function toStatus(s: string | null | undefined): "pending" | "approved" | "declined" | "waitlist" {
  switch (s) {
    case "approved": return "approved";
    case "declined": return "declined";
    case "waitlist": return "waitlist";
    default: return "pending";
  }
}

/**
 * Register a Notion 101 event from a Luma link, then backfill its guest list
 * into Neon + Notion. Idempotent: re-running updates the event and re-upserts guests.
 */
export async function registerEventFromLuma(input: string): Promise<RegisterResult> {
  const lumaEventId = await resolveLumaEventId(input);
  const detail = await getLumaEvent(lumaEventId);
  const event = await upsertEvent({
    lumaEventId,
    name: detail.name ?? null,
    startAt: detail.start_at ?? null,
    endAt: detail.end_at ?? null,
    timezone: detail.timezone ?? null,
    publicUrl: detail.url ?? null,
  });

  const guests = await listEventGuests(lumaEventId);
  let imported = 0;
  for (const entry of guests) {
    const answers: Record<string, string> = {};
    for (const a of entry.registration_answers ?? []) {
      if (a.question_id != null) answers[a.question_id] = String(a.answer ?? "");
    }
    const checkedIn = (entry.event_tickets ?? []).find((t) => t.checked_in_at)?.checked_in_at ?? null;
    const g = await upsertGuest({
      eventId: event.id,
      lumaGuestId: entry.api_id,
      name: entry.name ?? null,
      email: entry.email ?? null,
      lumaStatus: toStatus(entry.approval_status),
      checkedInAt: checkedIn,
      answers,
    });
    try { await pushGuestToNotion(g, event.name); imported++; }
    catch (err) { await logSync({ direction: "cron", result: "error", guestId: g.id, action: "backfill_push", note: err instanceof Error ? err.message : String(err) }); }
  }
  await logSync({ direction: "cron", result: "applied", action: "register_event", note: `${event.name} guests=${imported}` });
  return { eventName: event.name ?? lumaEventId, lumaEventId, guestsImported: imported };
}

export { getEventByLumaId };
```

> Confirm the `LumaGuestListEntry` fields used (`api_id`, `name`, `email`, `approval_status`, `registration_answers`, `event_tickets[].checked_in_at`) against `lib/luma/types.ts`; adjust names if REF differs.

- [ ] **Step 2: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/events/register.ts
git commit -m "feat: add event registration + guest backfill"
```

### Task 5.3: Decline-pending, reminders, survey selection logic

**Files:**
- Create: `lib/events/decline-pending.ts`, `lib/events/reminders.ts`, `lib/events/survey.ts`
- Test: `tests/decline-pending.test.ts`, `tests/reminder-select.test.ts`, `tests/survey-select.test.ts`

- [ ] **Step 1: Write failing test `tests/decline-pending.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { selectDeclinablePendings } from "../lib/events/decline-pending";
import type { GuestRow } from "../lib/db/guests";

const g = (status: GuestRow["luma_status"]): GuestRow => ({
  id: status, event_id: "e", luma_guest_id: status, name: null, email: null,
  luma_status: status, checked_in_at: null, answers: null, notion_page_id: null, last_synced_hash: null,
});

describe("selectDeclinablePendings", () => {
  it("selects only pending guests", () => {
    const out = selectDeclinablePendings([g("pending"), g("approved"), g("declined"), g("waitlist")]);
    expect(out.map((x) => x.luma_status)).toEqual(["pending"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → `npx vitest run tests/decline-pending.test.ts` → FAIL.

- [ ] **Step 3: Create `lib/events/decline-pending.ts`**

```ts
import { listEvents, getEventById } from "../db/events";
import { listGuestsForEvent, type GuestRow } from "../db/guests";
import { applyStatus, defaultApplyDeps } from "./apply-status";
import { isWithinDaysBefore } from "./dates";

export function selectDeclinablePendings(guests: GuestRow[]): GuestRow[] {
  return guests.filter((g) => g.luma_status === "pending");
}

/** Decline every still-pending guest for events happening tomorrow. */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const events = (await listEvents()).filter(
    (e) => e.start_at && isWithinDaysBefore(e.start_at, now, 1),
  );
  let guests = 0;
  for (const ev of events) {
    const pendings = selectDeclinablePendings(await listGuestsForEvent(ev.id));
    for (const g of pendings) {
      await applyStatus(g, "declined", defaultApplyDeps("cron", g.id));
      guests++;
    }
  }
  return { events: events.length, guests };
}

export { getEventById };
```

- [ ] **Step 4: Run test to verify it passes** → PASS.

- [ ] **Step 5: Write failing test `tests/reminder-select.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { reminderKindForEvent } from "../lib/events/reminders";

describe("reminderKindForEvent", () => {
  const now = new Date("2026-08-24T15:00:00Z");
  it("returns reminder_3d for an event 3 days out", () => {
    expect(reminderKindForEvent("2026-08-27T18:00:00Z", now)).toBe("reminder_3d");
  });
  it("returns reminder_1d for an event 1 day out", () => {
    expect(reminderKindForEvent("2026-08-25T18:00:00Z", now)).toBe("reminder_1d");
  });
  it("returns null otherwise", () => {
    expect(reminderKindForEvent("2026-08-26T18:00:00Z", now)).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails** → FAIL.

- [ ] **Step 7: Create `lib/events/reminders.ts`**

```ts
import { listEvents } from "../db/events";
import { listApprovedForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";
import { isWithinDaysBefore } from "./dates";
import type { EmailKind } from "../email/templates";

/** Which reminder (if any) an event's start date warrants relative to `now`. */
export function reminderKindForEvent(startIso: string, now: Date): EmailKind | null {
  if (isWithinDaysBefore(startIso, now, 3)) return "reminder_3d";
  if (isWithinDaysBefore(startIso, now, 1)) return "reminder_1d";
  return null;
}

/** Send the due reminder (3-day or 1-day) to all approved guests. */
export async function dispatchReminders(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    if (!ev.start_at) continue;
    const kind = reminderKindForEvent(ev.start_at, now);
    if (!kind) continue;
    for (const g of await listApprovedForEvent(ev.id)) {
      await sendGuestEmail(g.id, kind);
      sent++;
    }
  }
  return { sent };
}
```

- [ ] **Step 8: Run test to verify it passes** → PASS.

- [ ] **Step 9: Write failing test `tests/survey-select.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { eventEndedInWindow } from "../lib/events/survey";

describe("eventEndedInWindow", () => {
  const now = new Date("2026-08-24T20:00:00Z");
  it("true when the event ended within the trailing window (default 2–6h ago)", () => {
    expect(eventEndedInWindow("2026-08-24T16:00:00Z", now)).toBe(true); // 4h ago
  });
  it("false when it ended too recently", () => {
    expect(eventEndedInWindow("2026-08-24T19:30:00Z", now)).toBe(false); // 0.5h ago
  });
  it("false when it ended too long ago", () => {
    expect(eventEndedInWindow("2026-08-24T10:00:00Z", now)).toBe(false); // 10h ago
  });
});
```

- [ ] **Step 10: Run test to verify it fails** → FAIL.

- [ ] **Step 11: Create `lib/events/survey.ts`**

```ts
import { listEvents } from "../db/events";
import { listCheckedInForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";

const HOUR = 3600_000;

/**
 * True if the event ended between `minH` and `maxH` hours before `now`. The
 * survey cron runs hourly; a 2–6h trailing window guarantees exactly one hit
 * per event without double-sending (email_log also dedups).
 */
export function eventEndedInWindow(endIso: string, now: Date, minH = 2, maxH = 6): boolean {
  const ended = new Date(endIso).getTime();
  const delta = now.getTime() - ended;
  return delta >= minH * HOUR && delta < maxH * HOUR;
}

/** Send the survey to checked-in guests of events that ended a few hours ago. */
export async function dispatchSurvey(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    const end = ev.end_at ?? ev.start_at;
    if (!end || !eventEndedInWindow(end, now)) continue;
    for (const g of await listCheckedInForEvent(ev.id)) {
      await sendGuestEmail(g.id, "survey");
      sent++;
    }
  }
  return { sent };
}
```

- [ ] **Step 12: Run test to verify it passes** → PASS.

- [ ] **Step 13: Run full suite + typecheck** → `npx vitest run && npm run typecheck` → PASS.

- [ ] **Step 14: Commit**

```bash
git add lib/events/decline-pending.ts lib/events/reminders.ts lib/events/survey.ts tests/decline-pending.test.ts tests/reminder-select.test.ts tests/survey-select.test.ts
git commit -m "feat: add decline-pending, reminders, survey selection + dispatch"
```

---

## Phase 6 — HTTP routes (webhooks, crons, health)

### Task 6.1: Health + cron auth helper

**Files:**
- Create: `lib/http/cron-auth.ts`, `app/api/health/route.ts`

- [ ] **Step 1: Create `lib/http/cron-auth.ts`**

```ts
import { env } from "../env";

/** True if the request carries the cron secret (header or bearer). */
export function isAuthorizedCron(req: Request): boolean {
  const secret = env.app.cronSecret();
  if (!secret) return false;
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return provided === secret;
}
```

- [ ] **Step 2: Create `app/api/health/route.ts`**

```ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET() {
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/http/cron-auth.ts app/api/health/route.ts
git commit -m "feat: add health check + cron auth helper"
```

### Task 6.2: Luma inbound webhook route

**Files:**
- Create: `app/api/webhooks/luma/route.ts`

- [ ] **Step 1: Create `app/api/webhooks/luma/route.ts`**

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { parseGuestWebhook } from "@/lib/luma/parse";
import { getEventByLumaId } from "@/lib/db/events";
import { upsertGuest } from "@/lib/db/guests";
import { pushGuestToNotion } from "@/lib/notion/push";
import { logSync } from "@/lib/db/sync-log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();

  // Verify HMAC if a secret is configured (verify.ts returns true when unset — dev).
  const secret = env.luma.webhookSecret();
  if (secret && !verifyLumaSignature(raw, req.headers, secret)) {
    await logSync({ direction: "luma_in", result: "error", action: "verify", note: "bad signature" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch {
    await logSync({ direction: "luma_in", result: "error", action: "received", note: `invalid json: ${raw.slice(0, 300)}` });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseGuestWebhook(body);
  if (!parsed) return NextResponse.json({ received: true, ignored: "no guest" });

  const event = await getEventByLumaId(parsed.lumaEventId);
  if (!event) {
    // Scoping gate — only registered Notion 101 events flow into the DB.
    await logSync({ direction: "luma_in", result: "skipped", action: "unregistered_event", note: parsed.lumaEventId });
    return NextResponse.json({ received: true, ignored: "unregistered event" });
  }

  const guest = await upsertGuest({
    eventId: event.id,
    lumaGuestId: parsed.lumaGuestId,
    name: parsed.name,
    email: parsed.email,
    lumaStatus: parsed.lumaStatus,
    checkedInAt: parsed.checkedInAt,
    answers: parsed.answers,
  });
  try {
    await pushGuestToNotion(guest, event.name);
    await logSync({ direction: "luma_in", result: "applied", guestId: guest.id, action: `guest_${parsed.type}` });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", guestId: guest.id, action: "notion_push", note: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json({ received: true });
}
```

> Confirm `verifyLumaSignature`'s signature (args: raw body, headers, secret) matches the copied `verify.ts`; adapt the call if REF exposes a different function name/shape.

- [ ] **Step 2: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/luma/route.ts
git commit -m "feat: add Luma inbound webhook (upsert + Notion mirror + scoping gate)"
```

### Task 6.3: Notion inbound webhook route (approve/decline → Luma)

**Files:**
- Create: `app/api/webhooks/notion/route.ts`

- [ ] **Step 1: Create `app/api/webhooks/notion/route.ts`**

```ts
import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { getNotionClient } from "@/lib/notion/client";
import { readStatusFromPage } from "@/lib/notion/mappers";
import { isEcho } from "@/lib/events/hash";
import { getGuestByNotionPageId } from "@/lib/db/guests";
import { applyStatus, defaultApplyDeps } from "@/lib/events/apply-status";
import { logSync } from "@/lib/db/sync-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const SETTLE_MS = 3000; // let the button's property edit commit before we read

export async function POST(req: Request) {
  const raw = await req.text();
  let body: { page_id?: string; pageId?: string; id?: string; secret?: string; data?: { id?: string } } = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch {
    await logSync({ direction: "notion_in", result: "error", action: "received", note: `invalid json: ${raw.slice(0, 300)}` });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const secret = env.notion.webhookSecret();
  const provided = req.headers.get("x-webhook-secret") ?? body.secret;
  if (secret && provided !== secret) {
    await logSync({ direction: "notion_in", result: "error", action: "verify", note: "bad secret" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pageId = body.data?.id ?? body.page_id ?? body.pageId ?? body.id;
  if (!pageId) {
    await logSync({ direction: "notion_in", result: "error", action: "received", note: "no page id" });
    return NextResponse.json({ error: "missing page id" }, { status: 400 });
  }

  // Ack fast; do the work off the response path (Fluid Compute keeps us alive).
  after(() => processNotion(pageId));
  return NextResponse.json({ received: true });
}

async function processNotion(pageId: string): Promise<void> {
  try {
    const guest = await getGuestByNotionPageId(pageId);
    if (!guest) {
      await logSync({ direction: "notion_in", result: "error", action: "resolve", note: `no guest for page ${pageId}` });
      return;
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const notion = getNotionClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await notion.pages.retrieve({ page_id: pageId })) as any;

    const nextStatus = readStatusFromPage(page);
    if (!nextStatus) {
      await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: "noop_no_status" });
      return;
    }

    // Echo guard: drop if this matches our own last write.
    if (isEcho({ name: guest.name ?? "", email: guest.email ?? "", status: nextStatus }, guest.last_synced_hash)) {
      await logSync({ direction: "notion_in", result: "skipped", guestId: guest.id, action: "echo" });
      return;
    }
    if (nextStatus === guest.luma_status) {
      await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: "noop_unchanged" });
      return;
    }

    await applyStatus(guest, nextStatus, defaultApplyDeps("notion_in", guest.id));
    await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: `status:${nextStatus}` });
  } catch (err) {
    await logSync({ direction: "notion_in", result: "error", action: "process", note: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 2: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/notion/route.ts
git commit -m "feat: add Notion inbound webhook (status → Luma + email + mirror)"
```

### Task 6.4: Cron routes

**Files:**
- Create: `app/api/cron/decline-pending/route.ts`, `app/api/cron/reminders/route.ts`, `app/api/cron/survey/route.ts`, `app/api/cron/comms-retry/route.ts`, `app/api/cron/reconcile/route.ts`

- [ ] **Step 1: Create `app/api/cron/decline-pending/route.ts`**

```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { dispatchDeclinePendingForTomorrow } from "@/lib/events/decline-pending";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await dispatchDeclinePendingForTomorrow();
  return NextResponse.json(result);
}
export const GET = POST;
```

- [ ] **Step 2: Create `app/api/cron/reminders/route.ts`** — same shape, calling `dispatchReminders()`.

```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { dispatchReminders } from "@/lib/events/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await dispatchReminders());
}
export const GET = POST;
```

- [ ] **Step 3: Create `app/api/cron/survey/route.ts`** — same shape, calling `dispatchSurvey()`.

```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { dispatchSurvey } from "@/lib/events/survey";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await dispatchSurvey());
}
export const GET = POST;
```

- [ ] **Step 4: Create `app/api/cron/comms-retry/route.ts`** — replays failed email_log rows.

```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { listFailed } from "@/lib/db/email-log";
import { sendGuestEmail } from "@/lib/email/comms";
import type { EmailKind } from "@/lib/email/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const failed = await listFailed();
  for (const row of failed) await sendGuestEmail(row.guest_id, row.kind as EmailKind);
  return NextResponse.json({ retried: failed.length });
}
export const GET = POST;
```

- [ ] **Step 5: Create `app/api/cron/reconcile/route.ts`** — re-pulls guest lists for registered events to catch missed webhooks (status + check-in).

```ts
import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { listEvents } from "@/lib/db/events";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const events = await listEvents();
  let reconciled = 0;
  for (const ev of events) {
    // Re-running registration re-upserts guests (idempotent) and re-mirrors to Notion.
    await registerEventFromLuma(ev.luma_event_id);
    reconciled++;
  }
  return NextResponse.json({ reconciled });
}
export const GET = POST;
```

- [ ] **Step 6: Create `vercel.json`** (schedules from spec §8)

```json
{
  "crons": [
    { "path": "/api/cron/decline-pending", "schedule": "0 13 * * *" },
    { "path": "/api/cron/reminders", "schedule": "0 15 * * *" },
    { "path": "/api/cron/survey", "schedule": "0 * * * *" },
    { "path": "/api/cron/comms-retry", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/reconcile", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 7: Verify typecheck + build** — `npm run typecheck && npm run build` → PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/cron vercel.json
git commit -m "feat: add cron routes (decline-pending, reminders, survey, comms-retry, reconcile)"
```

---

## Phase 7 — Setup scripts

### Task 7.1: Create-Notion-database script (schema + question map)

**Files:**
- Create: `scripts/create-notion-database.ts`

- [ ] **Step 1: Create `scripts/create-notion-database.ts`**

Behavior: given a parent page id (`--parent`) and a Luma event (`--luma`, for deriving select options), create the guest database with all §5 properties and write `lib/notion/QUESTION_MAP.json` mapping each Luma `question_id` → `{ prop, kind }`.

```ts
/**
 * Create the Notion 101 guest database and pin the Luma question→property map.
 *
 * Usage:
 *   npm run setup:notion -- --parent <notion-page-id> --luma <evt-id-or-url>
 *
 * Writes lib/notion/QUESTION_MAP.json (consumed by lib/notion/schema.ts).
 */
import { writeFileSync } from "node:fs";
import { Client } from "@notionhq/client";
import { env } from "../lib/env";
import { resolveLumaEventId, getLumaEvent, extractQuestionOptions } from "../lib/luma/client";
import { PROP } from "../lib/notion/schema";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parent = arg("--parent");
  const luma = arg("--luma");
  if (!parent || !luma) { console.error("Required: --parent <page-id> --luma <evt-id-or-url>"); process.exit(1); }

  const notion = new Client({ auth: env.notion.token() });
  const detail = await getLumaEvent(await resolveLumaEventId(luma));
  const questions = detail.registration_questions ?? [];

  // Heuristic label→property/kind wiring for the known Notion 101 form.
  const byLabel = (re: RegExp) => questions.find((q) => re.test(q.label ?? ""));
  const opt = (q: unknown) => (q ? extractQuestionOptions([q as never]).map((name) => ({ name })) : []);

  const qCompany = byLabel(/company do you own/i);
  const qSize = byLabel(/size of your company/i);
  const qTrack = byLabel(/track best fits/i);
  const qNotionEmail = byLabel(/email do you use for notion/i);
  const qPlan = byLabel(/type of notion plan/i);
  const qExp = byLabel(/experience level with notion/i);
  const qWhy = byLabel(/why do you want to come/i);
  const qNotes = byLabel(/anything you want us to know/i);

  const properties: Record<string, unknown> = {
    [PROP.name]: { title: {} },
    [PROP.email]: { email: {} },
    [PROP.status]: { select: { options: [
      { name: "Pending" }, { name: "Approved" }, { name: "Declined" }, { name: "Waitlist" },
    ] } },
    [PROP.checkedIn]: { date: {} },
    [PROP.event]: { rich_text: {} },
    [PROP.registeredAt]: { date: {} },
    [PROP.company]: { rich_text: {} },
    [PROP.jobTitle]: { rich_text: {} },
    [PROP.companySize]: { select: { options: opt(qSize) } },
    [PROP.businessTrack]: { select: { options: opt(qTrack) } },
    [PROP.notionAccountEmail]: { email: {} },
    [PROP.notionPlan]: { select: { options: opt(qPlan) } },
    [PROP.notionExperience]: { select: { options: opt(qExp) } },
    [PROP.whyAttending]: { multi_select: { options: opt(qWhy) } },
    [PROP.notes]: { rich_text: {} },
    [PROP.lumaGuestId]: { rich_text: {} },
    [PROP.lumaEventId]: { rich_text: {} },
  };

  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parent } as never,
    title: [{ type: "text", text: { content: "Notion 101 — Guests" } }] as never,
    properties: properties as never,
  });

  const map: Record<string, { prop: string; kind: string }> = {};
  const put = (q: { api_id?: string } | undefined, prop: string, kind: string) => {
    if (q?.api_id) map[q.api_id] = { prop, kind };
  };
  put(qCompany, PROP.company, "rich_text");
  put(qSize, PROP.companySize, "select");
  put(qTrack, PROP.businessTrack, "select");
  put(qNotionEmail, PROP.notionAccountEmail, "email");
  put(qPlan, PROP.notionPlan, "select");
  put(qExp, PROP.notionExperience, "select");
  put(qWhy, PROP.whyAttending, "multi_select");
  put(qNotes, PROP.notes, "rich_text");

  writeFileSync(new URL("../lib/notion/QUESTION_MAP.json", import.meta.url), JSON.stringify(map, null, 2));

  // eslint-disable-next-line no-console
  console.log("Created DB:", db.id);
  console.log("Set NOTION_GUESTS_DB_ID and its data source id in .env.local.");
  console.log("Wrote lib/notion/QUESTION_MAP.json:", map);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

> Confirm `LumaRegistrationQuestion` exposes `api_id` (the question_id) and `label`/`options` in `lib/luma/types.ts`; adjust field names if REF differs. The company question's job-title sub-part maps to `Company` only until a dedicated question exists (spec §5 open item).

- [ ] **Step 2: Verify typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-notion-database.ts
git commit -m "feat: add create-notion-database setup script + question map writer"
```

### Task 7.2: Register-event CLI

**Files:**
- Create: `scripts/register-event.ts`

- [ ] **Step 1: Create `scripts/register-event.ts`**

```ts
/**
 * Register a Notion 101 event and backfill its guests.
 * Usage: npm run register:event -- --luma <evt-id-or-url>
 */
import { registerEventFromLuma } from "../lib/events/register";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const luma = arg("--luma");
  if (!luma) { console.error("Required: --luma <evt-id-or-url>"); process.exit(1); }
  const r = await registerEventFromLuma(luma);
  // eslint-disable-next-line no-console
  console.log(`Registered ${r.eventName} (${r.lumaEventId}) — imported ${r.guestsImported} guests`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/register-event.ts
git commit -m "feat: add register-event CLI"
```

---

## Phase 8 — Signup page, dashboard, auth

### Task 8.1: Dashboard auth (copy-adapt)

**Files:**
- Create: `lib/auth/session.ts`, `lib/auth/form-token.ts`, `app/login/page.tsx`, `app/api/login/route.ts`, `middleware.ts`

- [ ] **Step 1: Copy `REF/lib/auth/*` → `lib/auth/`** (session cookie + form token). Adapt env calls to `env.dashboard.password()` / `env.dashboard.sessionSecret()`.

- [ ] **Step 2: Copy `REF/middleware.ts` → `middleware.ts`** and adapt: protect `/` and `/add-event` (allow `/login`, `/api/webhooks/*`, `/api/cron/*`, `/api/health`). Confirm the matcher excludes webhook/cron/health paths so external callers aren't gated.

- [ ] **Step 3: Copy `REF/app/login/page.tsx` + login route** → adapt labels to "Notion 101".

- [ ] **Step 4: Verify typecheck + build** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth middleware.ts app/login app/api/login
git commit -m "feat: add dashboard auth (password session + middleware)"
```

### Task 8.2: Add-event signup page + route

**Files:**
- Create: `app/add-event/page.tsx`, `app/api/add-event/route.ts`, `components/AddEventForm.tsx`

- [ ] **Step 1: Copy `REF/app/add-event/page.tsx` + `REF/components/hub/AddEventForm.tsx`** → adapt: title "Track a Notion 101 event"; form posts the Luma link to `/api/add-event`.

- [ ] **Step 2: Create `app/api/add-event/route.ts`**

```ts
import { NextResponse } from "next/server";
import { verifyFormToken } from "@/lib/auth/form-token";
import { env } from "@/lib/env";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { lumaLink, token } = (await req.json()) as { lumaLink?: string; token?: string };
  if (!token || !verifyFormToken(env.dashboard.sessionSecret(), token)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  if (!lumaLink) return NextResponse.json({ error: "missing link" }, { status: 400 });
  try {
    const r = await registerEventFromLuma(lumaLink);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
```

> Match `verifyFormToken`'s signature to the copied `form-token.ts` (REF uses `issueFormToken(secret, now)` / a verify counterpart). Adapt arg order if needed.

- [ ] **Step 3: Verify typecheck + build** → PASS.

- [ ] **Step 4: Commit**

```bash
git add app/add-event app/api/add-event components/AddEventForm.tsx
git commit -m "feat: add event signup page + registration route"
```

### Task 8.3: Dashboard + manual actions

**Files:**
- Create: `app/page.tsx` (replace placeholder), `components/Dashboard.tsx`, `app/api/sync-now/route.ts`
- Create: `lib/db/dashboard.ts` (read helpers)

- [ ] **Step 1: Create `lib/db/dashboard.ts`** — read helpers for the dashboard.

```ts
import { sql } from "./client";

export async function eventSummaries(): Promise<
  { id: string; name: string | null; start_at: string | null;
    pending: number; approved: number; declined: number; waitlist: number; checked_in: number }[]
> {
  return (await sql`
    select e.id, e.name, e.start_at,
      count(*) filter (where g.luma_status='pending')  as pending,
      count(*) filter (where g.luma_status='approved')  as approved,
      count(*) filter (where g.luma_status='declined')  as declined,
      count(*) filter (where g.luma_status='waitlist')  as waitlist,
      count(*) filter (where g.checked_in_at is not null) as checked_in
    from events e left join guests g on g.event_id = e.id
    group by e.id order by e.start_at desc nulls last
  `) as never;
}

export async function recentEmailLog(limit = 50) {
  return (await sql`
    select el.kind, el.recipient_email, el.status, el.created_at, g.name
    from email_log el left join guests g on g.id = el.guest_id
    order by el.created_at desc limit ${limit}
  `) as never;
}

export async function recentSyncLog(limit = 50) {
  return (await sql`
    select direction, action, result, note, created_at from sync_log
    order by created_at desc limit ${limit}
  `) as never;
}
```

- [ ] **Step 2: Create `app/api/sync-now/route.ts`** — manual reconcile of one event (authorized by session cookie, checked in middleware) with a body `{ lumaEventId }`.

```ts
import { NextResponse } from "next/server";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { lumaEventId } = (await req.json()) as { lumaEventId?: string };
  if (!lumaEventId) return NextResponse.json({ error: "missing lumaEventId" }, { status: 400 });
  const r = await registerEventFromLuma(lumaEventId);
  return NextResponse.json(r);
}
```

- [ ] **Step 3: Create `components/Dashboard.tsx` + `app/page.tsx`** — a server component rendering `eventSummaries()`, `recentEmailLog()`, `recentSyncLog()`, plus a "Sync now" button per event (POSTs to `/api/sync-now`) and a link to `/add-event`. Keep styling minimal Tailwind (tables). (Full JSX left to the implementer; it's presentational and reads the helpers above — no new types.)

```tsx
// app/page.tsx
import { eventSummaries, recentEmailLog, recentSyncLog } from "@/lib/db/dashboard";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [events, emails, syncs] = await Promise.all([
    eventSummaries(), recentEmailLog(), recentSyncLog(),
  ]);
  return <Dashboard events={events} emails={emails} syncs={syncs} />;
}
```

`components/Dashboard.tsx` renders three tables (events with status counts + a Sync-now button; recent emails; recent sync log) and a header linking to `/add-event`. Use `"use client"` only for the Sync-now button; keep the tables server-rendered.

- [ ] **Step 4: Verify typecheck + build** → `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/Dashboard.tsx app/api/sync-now/route.ts lib/db/dashboard.ts
git commit -m "feat: add dashboard (event summaries, email + sync logs, sync-now)"
```

---

## Phase 9 — Final wiring & verification

### Task 9.1: Full suite, build, and README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite** → `npx vitest run` → all PASS.
- [ ] **Step 2: Run typecheck + build** → `npm run typecheck && npm run build` → PASS.
- [ ] **Step 3: Write `README.md`** documenting: architecture diagram (spec §2), env vars (§10), setup order (create Neon → apply schema → `setup:notion` → set env → register an event → configure Luma webhook → configure Notion "Send webhook" automation), and the cron schedule.
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README (setup, architecture, env, crons)"
```

### Task 9.2: Deployment checklist (manual, documented — not code)

Documented in README; performed at deploy time:
- [ ] Create Vercel project; add the **Neon** Marketplace integration (injects `DATABASE_URL`).
- [ ] Apply `lib/db/schema.sql` to the Neon database.
- [ ] Set all env vars from `.env.example` in Vercel (Luma, Notion, Resend, secrets, URLs).
- [ ] Run `npm run setup:notion -- --parent <page> --luma <evt>`; commit the generated `QUESTION_MAP.json`; set `NOTION_GUESTS_DATA_SOURCE_ID`.
- [ ] Share the Notion guest DB with the integration; add a **Status**-change "Send webhook" automation → `/api/webhooks/notion` with the `x-webhook-secret` header (+ optional Approve/Decline buttons).
- [ ] Configure the **Luma webhook** (guest.created/updated, check-in) → `/api/webhooks/luma` with `LUMA_WEBHOOK_SECRET`.
- [ ] Register the first event via `/add-event`.
- [ ] Verify: RSVP appears in Notion → approve in Notion → guest receives approval email + Luma shows approved → survey/reminder/decline crons fire on schedule.

---

## Self-Review Notes (author checklist — completed)

- **Spec coverage:** signup/scoping (Tasks 5.2, 6.2, 8.2) · Luma→Notion webhook (6.2) · Notion→Luma approve/decline (6.3, 5.1) · emails approve/decline/reminders/survey (4.2, 4.3, 5.3) · day-before auto-decline (5.3, 6.4) · check-in→survey audience (5.3, 6.4) · Neon model (1.1–1.3) · Notion DB w/ form fields + auto-derived options (3.x, 7.1) · crons (6.4) · dashboard (8.3) · tests (throughout).
- **Placeholder scan:** the only deferred-to-implementer piece is Dashboard JSX (presentational, reads defined helpers) — acceptable. All logic modules have full code + tests.
- **Type consistency:** `GuestRow`, `EventRow`, `LumaStatus`, `EmailKind`, `EmailFields`, `ApplyStatusDeps`, `QuestionMap` are defined once and reused with matching names across tasks. `sendGuestEmail`, `applyStatus`/`defaultApplyDeps`, `pushGuestToNotion`, `registerEventFromLuma` signatures are consistent across call sites.
- **Adaptation flags:** each copy-from-REF step lists the exact fields/signatures to confirm against the reference (Luma types, `verifyLumaSignature`, `buildInvite`, `form-token`), so drift is caught at implementation time.
