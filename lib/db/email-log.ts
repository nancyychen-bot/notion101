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
