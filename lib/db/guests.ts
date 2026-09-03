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

export async function setNotionPageId(id: string, pageId: string | null): Promise<void> {
  await sql`update guests set notion_page_id = ${pageId}, updated_at = now() where id = ${id}`;
}

/** Sentinel stored in notion_page_id while a page is being created, so concurrent
 * pushes for the same guest can tell "creation in progress" from "no page". */
export const NOTION_PAGE_CREATING = "__creating__";

/**
 * Atomically claim the right to create this guest's Notion page. Only the caller
 * that flips notion_page_id from NULL to the sentinel wins (Postgres row-level
 * atomicity); concurrent webhooks for the same guest lose and update instead of
 * creating a duplicate Notion row. Returns true iff this caller won.
 */
export async function claimNotionPageCreate(id: string): Promise<boolean> {
  const rows = (await sql`
    update guests set notion_page_id = ${NOTION_PAGE_CREATING}
    where id = ${id} and notion_page_id is null
    returning id
  `) as { id: string }[];
  return rows.length > 0;
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
