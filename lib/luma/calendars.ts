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
