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
