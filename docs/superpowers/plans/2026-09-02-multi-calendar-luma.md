# Multi-Calendar Luma Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Notion 101 track events from N Luma calendars (one API key + webhook secret each), with self-service onboarding, instead of a single hard-wired calendar.

**Architecture:** A `luma_calendars` registry table in Neon (server-only, no RLS needed) holds `(id, api_key, webhook_secret, calendar_id, city, calendar_url)`. A credential module (`lib/luma/calendars.ts`) merges env-defined calendars with DB rows (DB wins), caches for 60s, and fails open to env. Every event is tagged with its owning calendar id (`events.luma_calendar`), resolved once via Luma's authenticated API; all later outbound calls look up the key by that tag. Inbound webhooks verify against the pool of all secrets. Connecting a calendar requires the dashboard session; adding events to connected calendars stays public.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon Postgres (`@neondatabase/serverless`), Vitest, Node crypto for HMAC.

**Reference:** Ports `office-hours` (`lib/db/luma-calendars.ts`, `lib/luma/calendars.ts`, `lib/luma/client.ts`, `lib/events/onboard.ts`, `app/api/hub/add-{event,calendar}/route.ts`, `components/hub/AddEventForm.tsx`, `AddCalendarForm.tsx`). Spec: `docs/superpowers/specs/2026-09-02-multi-calendar-luma-design.md`.

**Conventions:** Tests live flat in `tests/*.test.ts` (Vitest, `@`→repo root alias). Run one test file: `npx vitest run tests/<file>.test.ts`. Typecheck: `npm run typecheck`. Full tests: `npm test`.

---

### Task 1: Registry schema

**Files:**
- Modify: `lib/db/schema.sql` (append at end)

- [ ] **Step 1: Append the table + tag column**

Add to the end of `lib/db/schema.sql`:

```sql
create table if not exists luma_calendars (
  id             text primary key,
  api_key        text not null,
  webhook_secret text,
  calendar_id    text,
  city           text,
  calendar_url   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists luma_calendars_calendar_id_idx on luma_calendars(calendar_id);

alter table events add column if not exists luma_calendar text;
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/schema.sql
git commit -m "feat(db): luma_calendars registry table + events.luma_calendar tag"
```

> Applying to Neon is a manual/ops step (same as the rest of `schema.sql`); the DDL is idempotent so re-applying is safe. Note in the PR that the table must be applied before deploy.

---

### Task 2: Data-access layer (`lib/db/luma-calendars.ts`)

**Files:**
- Create: `lib/db/luma-calendars.ts`
- Test: `tests/luma-calendars-db.test.ts`

- [ ] **Step 1: Write the failing test for `mapCalendarRow`**

Create `tests/luma-calendars-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapCalendarRow } from "../lib/db/luma-calendars";

describe("mapCalendarRow", () => {
  it("maps snake_case DB columns to camelCase", () => {
    expect(
      mapCalendarRow({
        id: "korea",
        api_key: "secret-abc",
        webhook_secret: "whsec-1",
        calendar_id: "cal-9",
        city: "Seoul",
        calendar_url: "https://luma.com/notion-korea",
      }),
    ).toEqual({
      id: "korea",
      apiKey: "secret-abc",
      webhookSecret: "whsec-1",
      calendarId: "cal-9",
      city: "Seoul",
      calendarUrl: "https://luma.com/notion-korea",
    });
  });

  it("preserves nulls", () => {
    expect(
      mapCalendarRow({ id: "x", api_key: "k", webhook_secret: null, calendar_id: null, city: null, calendar_url: null }),
    ).toMatchObject({ webhookSecret: null, calendarId: null, city: null, calendarUrl: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-calendars-db.test.ts`
Expected: FAIL — cannot import `mapCalendarRow` (module not found).

- [ ] **Step 3: Create the module**

Create `lib/db/luma-calendars.ts`:

```ts
import { sql } from "./client";

export interface LumaCalendarRow {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
  calendarId: string | null;
  city: string | null;
  calendarUrl: string | null;
}

interface RawRow {
  id: string;
  api_key: string;
  webhook_secret: string | null;
  calendar_id: string | null;
  city: string | null;
  calendar_url: string | null;
}

/** Pure snake_case → camelCase mapping (unit-tested without a DB). */
export function mapCalendarRow(r: RawRow): LumaCalendarRow {
  return {
    id: r.id,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    calendarId: r.calendar_id,
    city: r.city,
    calendarUrl: r.calendar_url,
  };
}

/** All calendar rows, ordered by id. Throws on DB error so callers fail loud. */
export async function listLumaCalendarRows(): Promise<LumaCalendarRow[]> {
  const rows = (await sql`
    select id, api_key, webhook_secret, calendar_id, city, calendar_url
    from luma_calendars order by id
  `) as RawRow[];
  return rows.map(mapCalendarRow);
}

/** A calendar by its slug id, or null (detects slug collisions before upsert). */
export async function getLumaCalendarById(id: string): Promise<LumaCalendarRow | null> {
  const rows = (await sql`
    select id, api_key, webhook_secret, calendar_id, city, calendar_url
    from luma_calendars where id = ${id}
  `) as RawRow[];
  return rows[0] ? mapCalendarRow(rows[0]) : null;
}

/** A calendar by its Luma cal- id, or null (dedupe on re-connect). */
export async function getLumaCalendarByCalendarId(calendarId: string): Promise<LumaCalendarRow | null> {
  const rows = (await sql`
    select id, api_key, webhook_secret, calendar_id, city, calendar_url
    from luma_calendars where calendar_id = ${calendarId}
  `) as RawRow[];
  return rows[0] ? mapCalendarRow(rows[0]) : null;
}

/** Create or replace a calendar (keyed on id/slug). */
export async function upsertLumaCalendar(input: LumaCalendarRow): Promise<void> {
  await sql`
    insert into luma_calendars (id, api_key, webhook_secret, calendar_id, city, calendar_url, updated_at)
    values (${input.id}, ${input.apiKey}, ${input.webhookSecret}, ${input.calendarId},
            ${input.city}, ${input.calendarUrl}, now())
    on conflict (id) do update set
      api_key = excluded.api_key, webhook_secret = excluded.webhook_secret,
      calendar_id = excluded.calendar_id, city = excluded.city,
      calendar_url = excluded.calendar_url, updated_at = now()
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-calendars-db.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add lib/db/luma-calendars.ts tests/luma-calendars-db.test.ts
git commit -m "feat(db): luma_calendars data-access layer"
```

---

### Task 3: Credential/routing module (`lib/luma/calendars.ts`)

**Files:**
- Create: `lib/luma/calendars.ts`
- Test: `tests/luma-calendars-routing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/luma-calendars-routing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LumaCalendarRow } from "../lib/db/luma-calendars";

// Mock the DB layer so we control what "the table" returns.
const listMock = vi.fn<[], Promise<LumaCalendarRow[]>>();
vi.mock("../lib/db/luma-calendars", () => ({
  listLumaCalendarRows: () => listMock(),
}));

import {
  lumaCalendars,
  apiKeyForCalendar,
  lumaWebhookSecrets,
  calendarUrlForCalendar,
  __bustCalendarCache,
} from "../lib/luma/calendars";

const OLD = process.env;
beforeEach(() => {
  process.env = { ...OLD };
  listMock.mockReset();
  __bustCalendarCache();
});
afterEach(() => {
  process.env = OLD;
});

describe("lumaCalendars", () => {
  it("seeds a 'default' calendar from env and lets DB rows override by id", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockResolvedValue([
      { id: "default", apiKey: "db-default", webhookSecret: "db-whsec", calendarId: "cal-1", city: null, calendarUrl: null },
      { id: "korea", apiKey: "db-korea", webhookSecret: "whsec-korea", calendarId: "cal-2", city: "Seoul", calendarUrl: "https://luma.com/notion-korea" },
    ]);
    const cals = await lumaCalendars();
    expect(cals.find((c) => c.id === "default")?.apiKey).toBe("db-default"); // DB wins
    expect(cals.find((c) => c.id === "korea")?.apiKey).toBe("db-korea");
  });

  it("fails open to env when the DB read throws", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockRejectedValue(new Error("db down"));
    const cals = await lumaCalendars();
    expect(cals).toEqual([{ id: "default", apiKey: "env-default", webhookSecret: "env-whsec" }]);
  });
});

describe("apiKeyForCalendar", () => {
  it("returns the default key for null/empty id", async () => {
    process.env.LUMA_API_KEY = "env-default";
    listMock.mockResolvedValue([]);
    expect(await apiKeyForCalendar(null)).toBe("env-default");
    expect(await apiKeyForCalendar("")).toBe("env-default");
  });

  it("throws for an unknown calendar", async () => {
    listMock.mockResolvedValue([]);
    await expect(apiKeyForCalendar("nope")).rejects.toThrow(/Unknown Luma calendar/);
  });
});

describe("lumaWebhookSecrets", () => {
  it("collects every non-null secret across env + DB", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockResolvedValue([
      { id: "korea", apiKey: "k", webhookSecret: "whsec-korea", calendarId: null, city: null, calendarUrl: null },
      { id: "london", apiKey: "k2", webhookSecret: null, calendarId: null, city: null, calendarUrl: null },
    ]);
    const secrets = await lumaWebhookSecrets();
    expect(secrets.sort()).toEqual(["env-whsec", "whsec-korea"]);
  });
});

describe("calendarUrlForCalendar", () => {
  it("returns the DB row's url, else null", async () => {
    listMock.mockResolvedValue([
      { id: "korea", apiKey: "k", webhookSecret: null, calendarId: null, city: null, calendarUrl: "https://luma.com/notion-korea" },
    ]);
    expect(await calendarUrlForCalendar("korea")).toBe("https://luma.com/notion-korea");
    expect(await calendarUrlForCalendar("default")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-calendars-routing.test.ts`
Expected: FAIL — module `../lib/luma/calendars` not found.

- [ ] **Step 3: Create the module**

Create `lib/luma/calendars.ts`:

```ts
import { listLumaCalendarRows, type LumaCalendarRow } from "../db/luma-calendars";

export interface LumaCalendar {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
}

/** Env-defined calendars (original keyring). Kept so unsetting DB rows or a DB
 * outage still leaves existing calendars working. `LUMA_API_KEY` → 'default';
 * `LUMA_API_KEY_<NAME>` → '<name>' with optional `LUMA_WEBHOOK_SECRET_<NAME>`. */
function envLumaCalendars(): LumaCalendar[] {
  const cals: LumaCalendar[] = [];
  if (process.env.LUMA_API_KEY) {
    cals.push({ id: "default", apiKey: process.env.LUMA_API_KEY, webhookSecret: process.env.LUMA_WEBHOOK_SECRET || null });
  }
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^LUMA_API_KEY_(.+)$/.exec(name);
    if (!m || !value) continue;
    cals.push({
      id: m[1].toLowerCase(),
      apiKey: value,
      webhookSecret: process.env[`LUMA_WEBHOOK_SECRET_${m[1]}`] || null,
    });
  }
  return cals;
}

let cache: { at: number; cals: LumaCalendar[]; urls: Map<string, string | null> } | null = null;
// 60s TTL: after connecting a new calendar, other warm serverless instances may
// not see its webhook_secret for up to this long (an inbound webhook could 401 in
// that window). Self-healing via Luma retry + TTL. The write path calls
// __bustCalendarCache() so the connecting request itself is immediate.
const TTL_MS = 60_000;

export function __bustCalendarCache(): void {
  cache = null;
}

async function load(): Promise<{ cals: LumaCalendar[]; urls: Map<string, string | null> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  let rows: LumaCalendarRow[] = [];
  try {
    rows = await listLumaCalendarRows();
  } catch {
    rows = []; // fail-open to env — a DB blip must not break webhook verification
  }
  const byId = new Map<string, LumaCalendar>();
  const urls = new Map<string, string | null>();
  for (const c of envLumaCalendars()) byId.set(c.id, c);
  for (const r of rows) {
    byId.set(r.id, { id: r.id, apiKey: r.apiKey, webhookSecret: r.webhookSecret }); // DB wins
    urls.set(r.id, r.calendarUrl);
  }
  cache = { at: Date.now(), cals: [...byId.values()], urls };
  return cache;
}

/** All configured Luma calendars (DB rows merged over env; DB wins). */
export async function lumaCalendars(): Promise<LumaCalendar[]> {
  return (await load()).cals;
}

/** API key for a calendar id; empty/undefined → 'default'. Throws if unknown. */
export async function apiKeyForCalendar(id: string | null | undefined): Promise<string> {
  const cid = id || "default";
  const cal = (await lumaCalendars()).find((c) => c.id === cid);
  if (!cal) {
    const varName = cid === "default" ? "LUMA_API_KEY" : `LUMA_API_KEY_${cid.toUpperCase()}`;
    throw new Error(`Unknown Luma calendar "${cid}" — not in luma_calendars and ${varName} is not set.`);
  }
  return cal.apiKey;
}

/** Public calendar URL for a calendar id (DB row, else env), or null. */
export async function calendarUrlForCalendar(id: string | null | undefined): Promise<string | null> {
  const cid = id || "default";
  const fromDb = (await load()).urls.get(cid);
  if (fromDb) return fromDb;
  const suffix = cid === "default" ? "" : `_${cid.toUpperCase()}`;
  return process.env[`LUMA_CALENDAR_URL${suffix}`] || null;
}

/** Every configured webhook signing secret, for multi-calendar inbound verify. */
export async function lumaWebhookSecrets(): Promise<string[]> {
  return (await lumaCalendars()).map((c) => c.webhookSecret).filter((s): s is string => !!s);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-calendars-routing.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/luma/calendars.ts tests/luma-calendars-routing.test.ts
git commit -m "feat(luma): credential/routing module (DB∪env, 60s cache, fail-open)"
```

---

### Task 4: Pool signature verification (`verifyAnyLumaSignature`)

**Files:**
- Modify: `lib/luma/verify.ts` (add one exported function at the end)
- Test: `tests/luma-verify.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `tests/luma-verify.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { verifyAnyLumaSignature } from "../lib/luma/verify";

function sign(secret: string, body: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyAnyLumaSignature", () => {
  const body = '{"hello":"world"}';
  const now = 1_700_000_000;

  it("accepts a signature made with any secret in the pool", () => {
    const header = sign("whsec-korea", body, now);
    expect(
      verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: ["whsec-default", "whsec-korea"], nowSec: now }),
    ).toBe(true);
  });

  it("rejects when no secret matches", () => {
    const header = sign("whsec-unknown", body, now);
    expect(
      verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: ["whsec-default", "whsec-korea"], nowSec: now }),
    ).toBe(false);
  });

  it("rejects an empty pool", () => {
    const header = sign("whsec-default", body, now);
    expect(verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: [], nowSec: now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-verify.test.ts`
Expected: FAIL — `verifyAnyLumaSignature` is not exported.

- [ ] **Step 3: Add the function**

Append to `lib/luma/verify.ts` (after `verifyLumaSignature`):

```ts
/**
 * Verify an inbound signature against a POOL of secrets (multi-calendar). Returns
 * true if any secret validates it. The matching secret identifies the sending
 * calendar, but callers route by the event id in the body, not by which matched.
 */
export function verifyAnyLumaSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secrets: string[];
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  const { rawBody, signatureHeader, secrets, toleranceSec, nowSec } = params;
  return secrets.some((secret) =>
    verifyLumaSignature({ rawBody, signatureHeader, secret, toleranceSec, nowSec }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-verify.test.ts`
Expected: PASS (existing + 3 new cases).

- [ ] **Step 5: Commit**

```bash
git add lib/luma/verify.ts tests/luma-verify.test.ts
git commit -m "feat(luma): verifyAnyLumaSignature for multi-calendar webhook pool"
```

---

### Task 5: Luma client — per-calendar keys + authenticated resolution

**Files:**
- Modify: `lib/luma/client.ts`
- Test: `tests/luma-city.test.ts`

This adds an `apiKey` parameter to every outbound call, plus `cityFromGeo`,
`listUpcomingCalendarEvents`, two error classes, and a Cloudflare-proof
`resolveLumaEventId`.

- [ ] **Step 1: Write the failing test for `cityFromGeo`**

Create `tests/luma-city.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cityFromGeo } from "../lib/luma/client";

describe("cityFromGeo", () => {
  it("uses the structured city when present", () => {
    expect(cityFromGeo({ city: "New York", city_state: "New York, NY" })).toBe("New York");
  });
  it("falls back to the first segment of city_state (non-US, null city)", () => {
    expect(cityFromGeo({ city: null, city_state: "Seoul, South Korea" })).toBe("Seoul");
  });
  it("returns null when neither is present", () => {
    expect(cityFromGeo({})).toBeNull();
    expect(cityFromGeo(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-city.test.ts`
Expected: FAIL — `cityFromGeo` not exported.

- [ ] **Step 3: Edit `lib/luma/client.ts`**

**3a.** At the top, add an import of `lumaCalendars` (after the existing type imports):

```ts
import { lumaCalendars } from "./calendars";
```

**3b.** Add `cityFromGeo`, a URL-slug helper, `UpcomingCalEvent`, `listUpcomingCalendarEvents`, the resolution helpers, and the two error classes. Insert this block just above the existing `parseLumaEventId`:

```ts
/**
 * The event's city from Luma's `geo_address_json`. Luma leaves the structured
 * `city` null for many non-US addresses (e.g. Seoul: `city` null, `city_state` =
 * "Seoul, South Korea"), so fall back to the first segment of `city_state`.
 */
export function cityFromGeo(geo: Record<string, unknown> | null | undefined): string | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const city = str(geo?.["city"]);
  if (city) return city;
  const cityState = str(geo?.["city_state"]);
  if (cityState) return cityState.split(",")[0].trim() || null;
  return null;
}

/** Vanity slug of a Luma URL = its last non-empty path segment, lowercased. */
function slugFromUrl(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface UpcomingCalEvent {
  id: string; // evt-…
  url: string | null;
  calendarId: string | null;
  city: string | null;
}

/** All upcoming events for a calendar key (2-day back-buffer), paginated. */
export async function listUpcomingCalendarEvents(apiKey: string): Promise<UpcomingCalEvent[]> {
  const after = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const out: UpcomingCalEvent[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${BASE}/v1/calendars/events/list`);
    url.searchParams.set("after", after);
    url.searchParams.set("pagination_limit", "50");
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, { headers: { "x-luma-api-key": apiKey } });
    if (res.status === 401 || res.status === 403) {
      throw new LumaApiKeyInvalidError(`Luma rejected the API key: HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`Luma calendars/events/list failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      entries?: Array<{ id: string; url?: string; calendar_id?: string; geo_address_json?: Record<string, unknown> }>;
      has_more?: boolean; next_cursor?: string;
    };
    for (const e of body.entries ?? []) {
      out.push({ id: e.id, url: e.url ?? null, calendarId: e.calendar_id ?? null, city: cityFromGeo(e.geo_address_json) });
    }
    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function findEventIdInCalendar(apiKey: string, slug: string): Promise<string | null> {
  for (const e of await listUpcomingCalendarEvents(apiKey)) {
    if (e.url && slugFromUrl(e.url) === slug) return e.id;
  }
  return null;
}

/** Resolve a vanity URL to an evt- id by matching its slug against each connected
 * calendar's upcoming events (authenticated API — reliable from serverless, where
 * scraping the Cloudflare-fronted public page is not). Null if none list it. */
async function resolveEventIdViaCalendars(vanityUrl: string): Promise<string | null> {
  const slug = slugFromUrl(vanityUrl);
  if (!slug) return null;
  for (const cal of await lumaCalendars()) {
    try {
      const id = await findEventIdInCalendar(cal.apiKey, slug);
      if (id) return id;
    } catch {
      // A single key failing (revoked/rate-limited) shouldn't abort resolution.
    }
  }
  return null;
}

/** Luma rejected the API key (401/403) — wrong/revoked. Distinct from transient
 * 429/5xx so callers don't mislabel "Luma is down" as "bad key". */
export class LumaApiKeyInvalidError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "LumaApiKeyInvalidError";
  }
}

/** A URL that couldn't be resolved to an evt- id via any connected calendar (nor
 * the page scrape). For add-event this signals "this event's calendar isn't
 * connected" — the caller prompts to connect it. */
export class LumaUrlUnresolvedError extends Error {
  constructor(public url: string, detail: string) {
    super(detail);
    this.name = "LumaUrlUnresolvedError";
  }
}
```

**3c.** Replace the existing `resolveLumaEventId` body so it tries the
authenticated API first, then falls back to the HTML scrape. Replace the whole
existing function (from `export async function resolveLumaEventId` through its
closing brace) with:

```ts
/**
 * Resolve a Luma event id from user input: an `evt-…` id, any URL containing one,
 * or a public vanity URL. For a vanity URL, prefer the authenticated
 * calendars/events/list match (Cloudflare-proof, also identifies the owner); only
 * if that finds nothing, fall back to scraping the page's embedded evt- id (often
 * blocked from datacenter IPs).
 */
export async function resolveLumaEventId(input: string): Promise<string> {
  const trimmed = input.trim();
  const direct = trimmed.match(/evt-[A-Za-z0-9]+/);
  if (direct) return direct[0];

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /\b(lu\.ma|luma\.com)\//i.test(trimmed);
  if (!looksLikeUrl) throw new Error(`Could not find an evt- id in: ${input}`);

  const viaApi = await resolveEventIdViaCalendars(trimmed);
  if (viaApi) return viaApi;

  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Notion101/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new LumaUrlUnresolvedError(url, `Could not load Luma page ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new LumaUrlUnresolvedError(url, `Could not load Luma page ${url}: HTTP ${res.status}`);
  const found = (await res.text()).match(/evt-[A-Za-z0-9]+/);
  if (found) return found[0];
  throw new LumaUrlUnresolvedError(url, `No evt- id found on Luma page ${url}`);
}
```

**3d.** Add an `apiKey` parameter to the four outbound functions and use it
instead of `env.luma.apiKey()`:

- `listEventGuests(eventId: string, apiKey: string)` — change the fetch header to `"x-luma-api-key": apiKey`.
- `fetchEventStats(eventId: string, apiKey: string)` — change its internal call to `listEventGuests(eventId, apiKey)`.
- `getLumaEvent(eventId: string, apiKey: string)` — change the fetch header to `"x-luma-api-key": apiKey`.
- `updateGuestStatus(params: { eventLumaId: string; guestLumaId: string; status: LumaStatus; apiKey: string })` — change the fetch header to `"x-luma-api-key": params.apiKey`.

**3e.** Remove the now-unused `import { env } from "../env";` line at the top of
`client.ts` (all `env.luma.apiKey()` references are gone).

- [ ] **Step 4: Run the city test + typecheck**

Run: `npx vitest run tests/luma-city.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors ONLY at the outbound call sites fixed in Task 7 (`register.ts`, the setup script) and Task 8 (`apply-status.ts`) — `getLumaEvent`, `listEventGuests`, `updateGuestStatus` now require an `apiKey`. That is expected at this point; they are fixed in the next tasks. (No errors inside `client.ts` itself.)

- [ ] **Step 5: Commit**

```bash
git add lib/luma/client.ts tests/luma-city.test.ts
git commit -m "feat(luma): per-calendar apiKey params, cityFromGeo, authenticated event resolution"
```

---

### Task 6: Onboarding module (`lib/events/onboard.ts`)

**Files:**
- Create: `lib/events/onboard.ts`
- Test: `tests/onboard.test.ts`

- [ ] **Step 1: Write the failing test for `deriveCalendarId`**

Create `tests/onboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveCalendarId } from "../lib/events/onboard";

describe("deriveCalendarId", () => {
  it("normalizes the first usable candidate", () => {
    expect(deriveCalendarId("Korea", "Seoul", "cal-9")).toBe("korea");
    expect(deriveCalendarId("New York City", null, null)).toBe("new-york-city");
  });
  it("skips candidates that normalize to empty and falls through", () => {
    expect(deriveCalendarId("!!!", "Seoul", "cal-9")).toBe("seoul");
    expect(deriveCalendarId("", "   ", "cal-9")).toBe("cal-9");
  });
  it("never returns empty", () => {
    expect(deriveCalendarId(null, undefined, "")).toBe("calendar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/events/onboard.ts`**

```ts
import { listUpcomingCalendarEvents, LumaApiKeyInvalidError } from "../luma/client";
import { upsertLumaCalendar, getLumaCalendarByCalendarId, getLumaCalendarById } from "../db/luma-calendars";
import { __bustCalendarCache } from "../luma/calendars";

/** A slug is already taken by a DIFFERENT Luma calendar — connecting would
 * overwrite that calendar's credentials, so we reject instead. */
export class CalendarSlugTakenError extends Error {
  constructor(public slug: string) {
    super(`The short id "${slug}" is already used by a different calendar — pick another.`);
    this.name = "CalendarSlugTakenError";
  }
}

/** The slug of a Luma URL = its last path segment, lowercased. */
function slug(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Stable, URL-safe calendar id (= `events.luma_calendar`) from the preferred
 * inputs in order. Normalizes each candidate BEFORE falling back, so a value that
 * normalizes to empty (e.g. "!!!") doesn't win over a usable later one and produce
 * an unlookupable empty primary key. Always non-empty.
 */
export function deriveCalendarId(...parts: Array<string | null | undefined>): string {
  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  for (const p of parts) {
    const n = norm(p);
    if (n) return n;
  }
  return "calendar";
}

/**
 * Decide the registry id (slug) for a calendar being connected. Reuse the existing
 * row if this exact Luma calendar (`cal-` id) is already connected; otherwise
 * derive a slug and reject if it's already taken by a DIFFERENT calendar — so an
 * upsert(onConflict:"id") can never silently overwrite another calendar's key.
 */
export async function resolveCalendarSlug(
  slugInput: string, city: string | null, calendarId: string | null,
): Promise<string> {
  if (calendarId) {
    const sameCalendar = await getLumaCalendarByCalendarId(calendarId);
    if (sameCalendar) return sameCalendar.id; // re-connecting the same calendar
  }
  const id = deriveCalendarId(slugInput, city, calendarId);
  const clash = await getLumaCalendarById(id);
  if (clash && !(calendarId && clash.calendarId === calendarId)) {
    throw new CalendarSlugTakenError(id);
  }
  return id;
}

export interface OnboardResolution {
  eventId: string;
  calendarId: string | null;
  city: string | null;
  apiKey: string;
}

/**
 * Validate a pasted Luma API key against the event being added: list the key's
 * upcoming events and match by evt- id (if the input contains one) or vanity slug.
 * Returns the evt- id, owning cal- id, and city — all from the authenticated API,
 * so it doubles as proof the key is correct.
 */
export async function resolveNewCalendarEvent(input: { lumaEvent: string; apiKey: string }): Promise<OnboardResolution> {
  const wantedId = input.lumaEvent.match(/evt-[A-Za-z0-9]+/)?.[0] ?? null;
  const wantedSlug = slug(input.lumaEvent);
  const events = await listUpcomingCalendarEvents(input.apiKey);
  const match = events.find(
    (e) => (wantedId && e.id === wantedId) || (wantedSlug && e.url && slug(e.url) === wantedSlug),
  );
  if (!match) {
    throw new Error(
      "That API key can't see this event — check you copied the right calendar's key and that the event is upcoming.",
    );
  }
  return { eventId: match.id, calendarId: match.calendarId, city: match.city, apiKey: input.apiKey };
}

export interface ConnectCalendarInput {
  slug: string;
  apiKey: string;
  webhookSecret: string;
  calendarUrl: string;
  city?: string;
}

/**
 * Connect a Luma calendar WITHOUT an event (standalone /add-calendar). Validates
 * the key by listing the calendar's events (an empty list from a valid key still
 * confirms it), derives the `cal-` id from the calendar URL or first event, and
 * upserts the row. Deduped by `cal-` id. Throws if Luma rejects the key.
 */
export async function connectCalendar(
  input: ConnectCalendarInput,
): Promise<{ id: string; calendarId: string | null; city: string | null }> {
  let events: Awaited<ReturnType<typeof listUpcomingCalendarEvents>>;
  try {
    events = await listUpcomingCalendarEvents(input.apiKey);
  } catch (err) {
    if (err instanceof LumaApiKeyInvalidError) {
      throw new Error("That Luma API key isn't valid — copy it from the calendar's Settings → Options → Luma API.");
    }
    throw new Error("Couldn't reach Luma to validate the key — please try again in a moment.");
  }
  const calFromUrl = input.calendarUrl.match(/cal-[A-Za-z0-9]+/)?.[0] ?? null;
  const calendarId = calFromUrl ?? events[0]?.calendarId ?? null;
  const city = input.city?.trim() || events[0]?.city || null;
  const id = await resolveCalendarSlug(input.slug, city, calendarId);
  await upsertLumaCalendar({ id, apiKey: input.apiKey, webhookSecret: input.webhookSecret, calendarId, city, calendarUrl: input.calendarUrl });
  __bustCalendarCache();
  return { id, calendarId, city };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/onboard.ts tests/onboard.test.ts
git commit -m "feat(events): calendar onboarding (connect, resolve, deriveCalendarId)"
```

---

### Task 7: Tag events with their owning calendar (register + events DB + setup script)

**Files:**
- Modify: `lib/db/events.ts` (add `luma_calendar` to `EventRow` + `upsertEvent`)
- Modify: `lib/events/register.ts` (probe owner, tag event, use owner key, throw `CalendarNotConnectedError`)
- Modify: `scripts/create-notion-database.ts` (pass a key to `getLumaEvent`)

- [ ] **Step 1: Add `luma_calendar` to the events DB layer**

In `lib/db/events.ts`:

**1a.** Add `luma_calendar` to `EventRow`:

```ts
export interface EventRow {
  id: string;
  luma_event_id: string;
  name: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  public_url: string | null;
  survey_url: string | null;
  location: string | null;
  luma_calendar: string | null;
}
```

**1b.** Add `lumaCalendar` to `upsertEvent`'s input type and the SQL. Replace the whole `upsertEvent` function with:

```ts
export async function upsertEvent(e: {
  lumaEventId: string; name?: string | null; startAt?: string | null;
  endAt?: string | null; timezone?: string | null; publicUrl?: string | null;
  location?: string | null; lumaCalendar?: string | null;
}): Promise<EventRow> {
  const rows = (await sql`
    insert into events (luma_event_id, name, start_at, end_at, timezone, public_url, location, luma_calendar)
    values (${e.lumaEventId}, ${e.name ?? null}, ${e.startAt ?? null}, ${e.endAt ?? null},
            ${e.timezone ?? null}, ${e.publicUrl ?? null}, ${e.location ?? null}, ${e.lumaCalendar ?? null})
    on conflict (luma_event_id) do update set
      name = excluded.name, start_at = excluded.start_at, end_at = excluded.end_at,
      timezone = excluded.timezone, public_url = excluded.public_url, location = excluded.location,
      luma_calendar = excluded.luma_calendar
    returning *
  `) as EventRow[];
  return rows[0];
}
```

- [ ] **Step 2: Rewrite `registerEventFromLuma` to resolve the owning calendar**

In `lib/events/register.ts`:

**2a.** Update the imports at the top:

```ts
import { resolveLumaEventId, getLumaEvent, listEventGuests, cityFromGeo } from "../luma/client";
import { lumaCalendars } from "../luma/calendars";
import type { LumaEventDetail } from "../luma/types";
```

(Keep the existing imports of `normalizeAnswers`, `upsertEvent`, `getEventByLumaId`, `upsertGuest`, `pushGuestToNotion`, `logSync`.)

**2b.** Add the error class near the top (after imports):

```ts
export class CalendarNotConnectedError extends Error {
  constructor(public eventId: string) {
    super(`Luma event ${eventId} is not on any connected calendar.`);
    this.name = "CalendarNotConnectedError";
  }
}
```

**2c.** Replace the body of `registerEventFromLuma` from the `const lumaEventId = ...` line down to (but not including) `const guests = await listEventGuests(...)` with the owner-probe + tag logic:

```ts
export async function registerEventFromLuma(input: string): Promise<RegisterResult> {
  const lumaEventId = await resolveLumaEventId(input);

  // Auto-detect the owning calendar: the host-only event endpoint returns the
  // event only for the calendar whose key owns it. Probe each configured
  // calendar; the first that resolves identifies it and provides the key.
  let detail: LumaEventDetail | null = null;
  let calendarId = "default";
  let apiKey = "";
  for (const cal of await lumaCalendars()) {
    try {
      detail = await getLumaEvent(lumaEventId, cal.apiKey);
      calendarId = cal.id;
      apiKey = cal.apiKey;
      break;
    } catch {
      // Not this calendar's event — try the next configured key.
    }
  }
  if (!detail) throw new CalendarNotConnectedError(lumaEventId);

  const event = await upsertEvent({
    lumaEventId,
    name: detail.name ?? null,
    startAt: detail.start_at ?? null,
    endAt: detail.end_at ?? null,
    timezone: detail.timezone ?? null,
    publicUrl: detail.url ?? null,
    location: cityFromGeo(detail.geo_address_json as Record<string, unknown> | null | undefined),
    lumaCalendar: calendarId,
  });

  const guests = await listEventGuests(lumaEventId, apiKey);
```

(The rest of the function — the `for (const entry of guests)` loop, `logSync`, and
`return` — is unchanged.)

- [ ] **Step 3: Fix the setup script call site**

In `scripts/create-notion-database.ts`, the line
`const detail = await getLumaEvent(await resolveLumaEventId(luma));` now needs a
key. The setup script targets the primary calendar, so use the env key. Add near
the top of the file:

```ts
import { env } from "../lib/env";
```

(If `env` is already imported, skip the import.) Then change the call to:

```ts
  const detail = await getLumaEvent(await resolveLumaEventId(luma), env.luma.apiKey());
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: remaining errors ONLY in `lib/events/apply-status.ts` (updateGuestStatus needs apiKey — fixed in Task 8). `register.ts`, `events.ts`, and the setup script now typecheck.

- [ ] **Step 5: Run the full test suite (nothing should regress)**

Run: `npm test`
Expected: PASS (register has no unit test; existing suites unaffected).

- [ ] **Step 6: Commit**

```bash
git add lib/db/events.ts lib/events/register.ts scripts/create-notion-database.ts
git commit -m "feat(events): resolve & tag owning calendar, key the backfill by it"
```

---

### Task 8: Outbound status pushes use the event's calendar key

**Files:**
- Modify: `lib/events/apply-status.ts` (default deps wiring only)
- Test: `tests/apply-status.test.ts` (unchanged — verifies no regression)

- [ ] **Step 1: Update the default deps**

In `lib/events/apply-status.ts`, update the bottom "Default deps wiring" section.

**1a.** Update imports there:

```ts
import { setLumaStatus } from "../db/guests";
import { getEventById, getEventByLumaId } from "../db/events";
import { updateGuestStatus } from "../luma/client";
import { apiKeyForCalendar } from "../luma/calendars";
import { sendGuestEmail } from "../email/comms";
import { pushGuestToNotion } from "../notion/push";
import { logSync } from "../db/sync-log";
```

**1b.** Replace the `updateGuestOnLuma` line in `defaultApplyDeps` with a version
that resolves the calendar's key:

```ts
    updateGuestOnLuma: async (eventLumaId, guestLumaId, s) => {
      const ev = await getEventByLumaId(eventLumaId);
      const apiKey = await apiKeyForCalendar(ev?.luma_calendar);
      await updateGuestStatus({ eventLumaId, guestLumaId, status: s, apiKey });
    },
```

(The rest of `defaultApplyDeps` and the whole `applyStatus` function are
unchanged. The `ApplyStatusDeps` interface is unchanged, so the existing tests —
which inject their own `updateGuestOnLuma` mock — keep passing.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (zero errors across the repo now).

- [ ] **Step 3: Run the apply-status tests**

Run: `npx vitest run tests/apply-status.test.ts`
Expected: PASS (mock deps unaffected by the wiring change).

- [ ] **Step 4: Commit**

```bash
git add lib/events/apply-status.ts
git commit -m "feat(events): outbound Luma status push uses the event's calendar key"
```

---

### Task 9: Inbound webhook verifies against the secret pool

**Files:**
- Modify: `app/api/webhooks/luma/route.ts`

- [ ] **Step 1: Swap single-secret verify for the pool**

In `app/api/webhooks/luma/route.ts`:

**1a.** Update imports — remove `env` (no longer used) and `verifyLumaSignature`,
add the pool helpers:

```ts
import { NextResponse } from "next/server";
import { verifyAnyLumaSignature } from "@/lib/luma/verify";
import { lumaWebhookSecrets } from "@/lib/luma/calendars";
import { parseGuestWebhook } from "@/lib/luma/parse";
import { getEventByLumaId } from "@/lib/db/events";
import { upsertGuest } from "@/lib/db/guests";
import { pushGuestToNotion } from "@/lib/notion/push";
import { logSync } from "@/lib/db/sync-log";
```

**1b.** Replace the verification block (the `const secret = env.luma.webhookSecret();`
`if (...)` block) with:

```ts
  // Verify against the pool of all configured webhook secrets (env + every
  // connected calendar). Enforced whenever ANY calendar has a secret — so a new
  // calendar's secret must be stored before its Luma webhook is enabled, else 401.
  const secrets = await lumaWebhookSecrets();
  if (secrets.length && !verifyAnyLumaSignature({ rawBody: raw, signatureHeader: req.headers.get("webhook-signature"), secrets })) {
    await logSync({ direction: "luma_in", result: "error", action: "verify", note: "bad signature" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
```

(The rest of the handler — JSON parse, `parseGuestWebhook`, the unregistered-event
gate, `upsertGuest`, `pushGuestToNotion`, logging — is unchanged. Inbound never
calls Luma outbound, so no key lookup is needed here.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/luma/route.ts
git commit -m "feat(webhook): verify inbound Luma signatures against the calendar secret pool"
```

---

### Task 10: `/api/add-event` — optional calendar connect (operator-gated)

**Files:**
- Modify: `app/api/add-event/route.ts`

The existing route takes JSON `{ lumaLink, token }`. Extend it to accept optional
calendar fields, gate the connect path behind the dashboard session, and return
`needsCalendar` so the form can reveal the connect fields.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/add-event/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyFormToken } from "@/lib/auth/form-token";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { resolveNewCalendarEvent, resolveCalendarSlug, CalendarSlugTakenError } from "@/lib/events/onboard";
import { upsertLumaCalendar } from "@/lib/db/luma-calendars";
import { __bustCalendarCache } from "@/lib/luma/calendars";
import { LumaUrlUnresolvedError, LumaApiKeyInvalidError } from "@/lib/luma/client";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  lumaLink?: string;
  token?: string;
  calendarApiKey?: string;
  calendarWebhookSecret?: string;
  calendarUrl?: string;
  calendarSlug?: string;
}

/** Connecting a NEW calendar writes credentials, so it requires the dashboard
 * session. Adding events to already-connected calendars stays public (form-token). */
async function operatorAuthed(): Promise<boolean> {
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value, env.dashboard.sessionSecret());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { lumaLink, token } = body;

  if (!token || !(await verifyFormToken(token, env.dashboard.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  }
  if (!lumaLink) {
    return NextResponse.json({ ok: false, error: "missing link" }, { status: 400 });
  }

  const calendarApiKey = body.calendarApiKey?.trim() || undefined;
  const calendarWebhookSecret = body.calendarWebhookSecret?.trim() || undefined;
  const calendarUrl = body.calendarUrl?.trim() || undefined;
  const calendarSlug = body.calendarSlug?.trim() || undefined;

  try {
    // New-calendar path: a key was pasted for an unconnected calendar. Requires
    // an operator login, then validates the key against the event and stores it.
    if (calendarApiKey) {
      if (!(await operatorAuthed())) {
        return NextResponse.json({
          ok: false,
          error: "Connecting a new calendar requires a dashboard login — ask Nancy Chen, or pre-register it at /add-calendar.",
        }, { status: 401 });
      }
      if (!calendarUrl) {
        return NextResponse.json({ ok: false, error: "A Luma calendar URL is required to connect a new calendar." }, { status: 400 });
      }
      if (!calendarWebhookSecret) {
        return NextResponse.json({ ok: false, error: "A webhook signing secret is required to connect a new calendar (enables live guest sync)." }, { status: 400 });
      }
      const resolved = await resolveNewCalendarEvent({ lumaEvent: lumaLink, apiKey: calendarApiKey });
      const id = await resolveCalendarSlug(calendarSlug ?? "", resolved.city, resolved.calendarId);
      await upsertLumaCalendar({
        id,
        apiKey: calendarApiKey,
        webhookSecret: calendarWebhookSecret,
        calendarId: resolved.calendarId,
        city: resolved.city,
        calendarUrl,
      });
      __bustCalendarCache();
    }

    const r = await registerEventFromLuma(lumaLink);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if ((err instanceof CalendarNotConnectedError || err instanceof LumaUrlUnresolvedError) && !calendarApiKey) {
      // Not an error — prompt to connect this calendar (reveals the fields).
      return NextResponse.json({
        ok: false,
        needsCalendar: true,
        error: "This event's Luma calendar isn't connected yet. Paste its Luma API key below to connect it (one-time), then add the event.",
      });
    }
    if (err instanceof CalendarSlugTakenError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: err.message }, { status: 400 });
    }
    if (err instanceof LumaApiKeyInvalidError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: "That Luma API key isn't valid — copy it from the calendar's Settings → Options → Luma API." }, { status: 400 });
    }
    const raw = err instanceof Error ? err.message : "";
    let msg = "Couldn't add that event — check the Luma event URL and try again.";
    if (/can't see this event/i.test(raw)) msg = raw;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

> Note: the success payload changes from `{ eventName, ... }` to
> `{ ok: true, eventName, lumaEventId, guestsImported }`. The form (Task 11) is
> updated to read `ok`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/add-event/route.ts
git commit -m "feat(add-event): optional operator-gated calendar connect + needsCalendar"
```

---

### Task 11: `/add-event` form — just-in-time calendar reveal

**Files:**
- Modify: `components/AddEventForm.tsx`
- Modify: `app/add-event/page.tsx` (pass the webhook URL)

- [ ] **Step 1: Pass the webhook URL into the form**

In `app/add-event/page.tsx`, add the import and compute the URL from the base URL,
then pass it to the form. Change the import line and the `<AddEventForm .../>`
usage:

```tsx
import { env } from "@/lib/env";
import { issueFormToken } from "@/lib/auth/form-token";
import { AddEventForm } from "@/components/AddEventForm";
```

```tsx
  const token = await issueFormToken(env.dashboard.sessionSecret(), Date.now());
  const webhookUrl = `${env.app.baseUrl()}/api/webhooks/luma`;
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Track a Notion 101 event</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste the Luma event link. We&apos;ll pull its details and import registered guests into
        the database and Notion.
      </p>
      <AddEventForm token={token} webhookUrl={webhookUrl} />
    </main>
  );
```

(`env` is already imported in this file; keep a single import.)

- [ ] **Step 2: Rewrite the form with the JIT reveal**

Replace the entire contents of `components/AddEventForm.tsx` with:

```tsx
"use client";

import { useState } from "react";

type Result =
  | { ok: true; eventName: string; lumaEventId: string; guestsImported: number }
  | { ok: false; needsCalendar?: boolean; error: string };

export function AddEventForm({ token, webhookUrl }: { token: string; webhookUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [needsCalendar, setNeedsCalendar] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const form = e.currentTarget;
    const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() || undefined;
    const res = await fetch("/api/add-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        lumaLink: val("lumaLink"),
        calendarApiKey: val("calendarApiKey"),
        calendarWebhookSecret: val("calendarWebhookSecret"),
        calendarUrl: val("calendarUrl"),
        calendarSlug: val("calendarSlug"),
      }),
    });
    const data = (await res.json()) as Result & { eventName?: string };
    setResult(data);
    if (!data.ok && data.needsCalendar) setNeedsCalendar(true);
    setBusy(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-600">Luma event URL *</span>
        <input name="lumaLink" required placeholder="https://lu.ma/..." className={`mt-1 ${field}`} />
      </label>

      {needsCalendar ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Connect this Luma calendar (one-time)</p>
          <p className="text-amber-800">
            We don&apos;t have an API key for this event&apos;s calendar yet. In Luma, open the calendar →{" "}
            <strong>Settings → Options → Luma API</strong>, copy the <code>secret-…</code> key, and paste it below.
          </p>
          <p className="text-amber-800">
            <strong>Live guest sync:</strong> on that same Luma API page, add a webhook pointing to{" "}
            <code className="break-all rounded bg-amber-100 px-1 py-0.5">{webhookUrl}</code>, then paste the signing
            secret it gives you into the field below.
          </p>
          <p className="font-semibold text-amber-900">Ask Nancy Chen to help you if you&apos;re stuck here.</p>
          <input name="calendarApiKey" placeholder="secret-… (Luma API key)" className={field} />
          <input name="calendarWebhookSecret" placeholder="Webhook signing secret" className={field} />
          <input name="calendarUrl" placeholder="Luma calendar URL (e.g. https://luma.com/notion-korea)" className={field} />
          <input name="calendarSlug" placeholder="Short id / location (e.g. london or korea)" className={field} />
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add event"}
      </button>

      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Added <strong>{result.eventName}</strong>
          {result.guestsImported > 0
            ? ` — ${result.guestsImported} guest${result.guestsImported === 1 ? "" : "s"} imported`
            : ""}
          .
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
```

> The calendar inputs are not `required` (they only exist after the reveal and the
> server validates them); marking them required would block the first submit.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/AddEventForm.tsx app/add-event/page.tsx
git commit -m "feat(add-event): inline just-in-time calendar connect reveal"
```

---

### Task 12: `/api/add-calendar` — standalone connect (session-gated)

**Files:**
- Create: `app/api/add-calendar/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { connectCalendar, CalendarSlugTakenError } from "@/lib/events/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Standalone calendar onboarding (/add-calendar). Writes credentials, so it
 * requires the dashboard session. `/api/*` isn't in the middleware matcher, so
 * this route verifies the session itself. The key is validated against Luma
 * before the row is saved, so a bad key is never stored.
 */
export async function POST(req: Request) {
  if (!(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ ok: false, error: "Unauthorized — log in to the dashboard first." }, { status: 401 });
  }

  const form = await req.formData();
  const slug = String(form.get("slug") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const webhookSecret = String(form.get("webhookSecret") ?? "").trim();
  const calendarUrl = String(form.get("calendarUrl") ?? "").trim();
  const city = String(form.get("city") ?? "").trim() || undefined;

  const missing = ([
    ["short id", slug],
    ["Luma API key", apiKey],
    ["webhook signing secret", webhookSecret],
    ["Luma calendar URL", calendarUrl],
  ] as const).find(([, v]) => !v);
  if (missing) {
    return NextResponse.json({ ok: false, error: `A ${missing[0]} is required.` }, { status: 400 });
  }
  if (!/[a-z0-9]/i.test(slug)) {
    return NextResponse.json({ ok: false, error: "The short id must contain letters or numbers (a–z, 0–9), e.g. korea." }, { status: 400 });
  }

  try {
    const result = await connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city });
    return NextResponse.json({ ok: true, calendar: { id: result.id, city: result.city } });
  } catch (err) {
    console.error("[add-calendar] connect failed", err);
    const raw = err instanceof Error ? err.message : "";
    const known = err instanceof CalendarSlugTakenError || /isn't valid|try again/.test(raw);
    const msg = known ? raw : "Couldn't connect that calendar. Check the API key and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/add-calendar/route.ts
git commit -m "feat(add-calendar): session-gated standalone calendar connect API"
```

---

### Task 13: `/add-calendar` page + form + middleware gate + env docs

**Files:**
- Create: `app/add-calendar/page.tsx`
- Create: `components/AddCalendarForm.tsx`
- Modify: `middleware.ts` (add `/add-calendar` to the matcher)
- Modify: `.env.example` (document multi-calendar env vars)

- [ ] **Step 1: Create the form component**

Create `components/AddCalendarForm.tsx`:

```tsx
"use client";

import { useState } from "react";

type Result =
  | { ok: true; calendar: { id: string; city: string | null } }
  | { ok: false; error: string };

export function AddCalendarForm({ webhookUrl }: { webhookUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/add-calendar", { method: "POST", body: new FormData(e.currentTarget) });
    setResult((await res.json()) as Result);
    setBusy(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-neutral-600">Short id / location *</span>
        <input name="slug" required placeholder="e.g. korea or london" className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-600">Luma API key *</span>
        <input name="apiKey" required placeholder="secret-… (calendar → Settings → Options → Luma API)" className={`mt-1 ${field}`} />
      </label>
      <div className="space-y-1 text-sm">
        <label className="block">
          <span className="text-neutral-600">Webhook signing secret *</span>
          <input name="webhookSecret" required placeholder="whsec-…" className={`mt-1 ${field}`} />
        </label>
        <p className="text-neutral-500">
          On that same Luma API page, add a webhook pointing to{" "}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5">{webhookUrl}</code> (subscribe to guest
          registered/updated events for live check-in), then paste the signing secret it gives you above.
        </p>
      </div>
      <label className="block text-sm">
        <span className="text-neutral-600">Luma calendar URL *</span>
        <input name="calendarUrl" required placeholder="https://luma.com/notion-korea" className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-600">City (optional)</span>
        <input name="city" placeholder="Defaults to each event's address" className={`mt-1 ${field}`} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect calendar"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Connected calendar <strong>{result.calendar.id}</strong>
          {result.calendar.city ? ` (${result.calendar.city})` : ""}. Its events will import from now on.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 2: Create the page (session-gated)**

Create `app/add-calendar/page.tsx`:

```tsx
import { env } from "@/lib/env";
import { AddCalendarForm } from "@/components/AddCalendarForm";

export const metadata = { title: "Connect a Luma calendar" };

export default function AddCalendarPage() {
  const webhookUrl = `${env.app.baseUrl()}/api/webhooks/luma`;
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-lg font-semibold">Connect a Luma calendar</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pre-register a region&apos;s Luma calendar so its events import and sync automatically. You&apos;ll
        need that calendar&apos;s Luma API key and a webhook signing secret.
      </p>
      <AddCalendarForm webhookUrl={webhookUrl} />
    </main>
  );
}
```

> Gating is enforced by middleware (Step 3) + the API route's own session check
> (Task 12). No form-token needed.

- [ ] **Step 3: Gate the page in middleware**

In `middleware.ts`, add `/add-calendar` to the matcher array:

```ts
export const config = {
  matcher: ["/", "/feedback", "/volunteers", "/settings/:path*", "/add-calendar"],
};
```

- [ ] **Step 4: Document the env vars**

Append to `.env.example` (below the existing `LUMA_*` lines):

```bash
# Multi-calendar (optional): additional Luma calendars can also be added at
# runtime via the gated /add-calendar page (stored in the luma_calendars table).
# Env-defined calendars are a fallback keyring — the DB wins on id conflict.
# LUMA_API_KEY seeds the 'default' calendar. For extra env-defined calendars:
#   LUMA_API_KEY_<NAME>=secret-...          # e.g. LUMA_API_KEY_KOREA
#   LUMA_WEBHOOK_SECRET_<NAME>=whsec-...     # optional, for inbound verify
#   LUMA_CALENDAR_URL[_<NAME>]=https://luma.com/...   # optional, for emails
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (build compiles all routes/pages).

- [ ] **Step 6: Commit**

```bash
git add app/add-calendar/page.tsx components/AddCalendarForm.tsx middleware.ts .env.example
git commit -m "feat(add-calendar): session-gated page + form, middleware gate, env docs"
```

---

### Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS, zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — including the new files `tests/luma-calendars-db.test.ts`,
`tests/luma-calendars-routing.test.ts`, `tests/luma-verify.test.ts` (with the new
block), `tests/luma-city.test.ts`, `tests/onboard.test.ts`, and no regressions in
existing suites.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS — `/add-event`, `/add-calendar`, `/api/add-event`,
`/api/add-calendar`, `/api/webhooks/luma` all compile.

- [ ] **Step 4: Manual smoke checklist (document in PR, run after deploy)**

Not automated — record these in the PR description:
1. Apply the updated `lib/db/schema.sql` to Neon (creates `luma_calendars`, adds `events.luma_calendar`).
2. Confirm `DASHBOARD_PASSWORD` = the intended password and `SESSION_SECRET` are set in Vercel.
3. Existing default-calendar event: re-run `/add-event` with an already-tracked event → still imports (uses `'default'`).
4. New calendar via `/add-calendar` (logged in): connect with a real key + webhook secret → success; add one of its events via `/add-event` → imports; check-in a guest in Luma → appears in the hub (webhook live).
5. `/add-calendar` while logged out → redirected to `/login`.
6. `/add-event` (public) with an unconnected calendar, no key → shows the amber "connect this calendar" reveal; submitting a key while logged out → 401 "requires a dashboard login".

---

## Self-review notes

- **Spec coverage:** §1 data layer → Tasks 1–2; §2 credential module → Task 3; §3 client async ripple + resolution → Tasks 5,7,8; §4 webhook pool → Tasks 4,9; §5 onboarding/routes/pages → Tasks 6,10,11,12,13; §6 testing → tests across Tasks 2–6 + Task 14. Gating decision → Tasks 10,12,13.
- **Type consistency:** `LumaCalendarRow`/`LumaCalendar`, `apiKeyForCalendar`, `resolveCalendarSlug`, `CalendarNotConnectedError`, `CalendarSlugTakenError`, `LumaUrlUnresolvedError`, `LumaApiKeyInvalidError`, `EventRow.luma_calendar`, and `upsertEvent({ lumaCalendar })` are defined once and referenced consistently.
- **Known limitation (from spec):** `QUESTION_MAP.json` maps only the primary Notion database's question ids; events on other calendars with different question ids may have blank answer columns until the map is extended. Out of scope here.
```
