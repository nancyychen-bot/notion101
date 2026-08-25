import { sql } from "./client";

export async function eventSummaries(): Promise<
  {
    id: string;
    luma_event_id: string;
    name: string | null;
    start_at: string | null;
    pending: number;
    approved: number;
    declined: number;
    waitlist: number;
    checked_in: number;
  }[]
> {
  return (await sql`
    select e.id, e.luma_event_id, e.name, e.start_at,
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
