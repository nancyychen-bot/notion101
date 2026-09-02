import { sql } from "./client";
import type { FeedbackRecord, AttendeeRow } from "../hub/results";

export async function eventSummaries(): Promise<
  {
    id: string;
    luma_event_id: string;
    name: string | null;
    start_at: string | null;
    location: string | null;
    timezone: string | null;
    registered: number;
    pending: number;
    approved: number;
    declined: number;
    waitlist: number;
    checked_in: number;
  }[]
> {
  return (await sql`
    select e.id, e.luma_event_id, e.name, e.start_at, e.location, e.timezone,
      -- ::int so the Neon HTTP driver returns numbers, not bigint strings
      count(g.id)::int as registered,
      count(*) filter (where g.luma_status='pending')::int   as pending,
      count(*) filter (where g.luma_status='approved')::int  as approved,
      count(*) filter (where g.luma_status='declined')::int  as declined,
      count(*) filter (where g.luma_status='waitlist')::int  as waitlist,
      count(*) filter (where g.checked_in_at is not null)::int as checked_in
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
