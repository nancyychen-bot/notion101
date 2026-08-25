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

export interface EmailLogRow {
  kind: string; recipient_email: string; status: string; created_at: string;
  guest_name: string | null; event_name: string | null;
}

const PAGE_SIZE = 50;

/** One page of sent-email history, newest first, optionally filtered. */
export async function listEmailLog(
  opts: { kind?: string | null; eventId?: string | null; page?: number } = {},
): Promise<{ rows: EmailLogRow[]; hasMore: boolean }> {
  const page = Math.max(0, opts.page ?? 0);
  const kind = opts.kind || null;
  const eventId = opts.eventId || null;
  const rows = (await sql`
    select el.kind, el.recipient_email, el.status, el.created_at,
           g.name as guest_name, ev.name as event_name
    from email_log el
    left join guests g on g.id = el.guest_id
    left join events ev on ev.id = g.event_id
    where (${kind}::text is null or el.kind = ${kind})
      and (${eventId}::uuid is null or ev.id = ${eventId})
    order by el.created_at desc
    limit ${PAGE_SIZE + 1} offset ${page * PAGE_SIZE}
  `) as EmailLogRow[];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

/** Distinct kinds + events for the log filters. */
export async function listEmailFilterOptions(): Promise<{
  kinds: string[]; events: { id: string; name: string | null }[];
}> {
  const kinds = (await sql`select distinct kind from email_log order by kind`) as { kind: string }[];
  const events = (await sql`select id, name from events order by created_at desc`) as { id: string; name: string | null }[];
  return { kinds: kinds.map((k) => k.kind), events };
}
