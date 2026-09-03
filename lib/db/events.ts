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
  location: string | null;
  luma_calendar: string | null;
}

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
