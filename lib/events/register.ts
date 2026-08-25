import { resolveLumaEventId, getLumaEvent, listEventGuests } from "../luma/client";
import { normalizeAnswers } from "../luma/answers";
import { upsertEvent, getEventByLumaId } from "../db/events";
import { upsertGuest } from "../db/guests";
import { pushGuestToNotion } from "../notion/push";
import { logSync } from "../db/sync-log";

export interface RegisterResult {
  eventName: string;
  lumaEventId: string;
  guestsImported: number;
}

function toStatus(s: string | null | undefined): "pending" | "approved" | "declined" | "waitlist" {
  switch (s) {
    case "approved": return "approved";
    case "declined": return "declined";
    case "waitlist": return "waitlist";
    default: return "pending";
  }
}

/**
 * Derive a display name from a Luma guest list entry.
 * Prefer user_name; else join user_first_name + user_last_name (trimmed); else null.
 */
function deriveName(entry: {
  user_name?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
}): string | null {
  if (entry.user_name && entry.user_name.trim()) return entry.user_name.trim();
  const composed = [entry.user_first_name, entry.user_last_name]
    .filter((p): p is string => !!p && !!p.trim())
    .join(" ")
    .trim();
  return composed || null;
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
    location: detail.geo_address_json?.full_address ?? detail.geo_address_json?.city_state ?? null,
  });

  const guests = await listEventGuests(lumaEventId);
  let imported = 0;
  for (const entry of guests) {
    const answers = normalizeAnswers(entry.registration_answers);
    const checkedIn =
      (entry.event_tickets ?? []).find((t) => t.checked_in_at)?.checked_in_at ?? null;
    const g = await upsertGuest({
      eventId: event.id,
      lumaGuestId: entry.id,
      name: deriveName(entry),
      email: entry.user_email ?? null,
      lumaStatus: toStatus(entry.approval_status),
      checkedInAt: checkedIn,
      answers,
    });
    try {
      await pushGuestToNotion(g, event);
      imported++;
    } catch (err) {
      await logSync({
        direction: "cron",
        result: "error",
        guestId: g.id,
        action: "backfill_push",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await logSync({
    direction: "cron",
    result: "applied",
    action: "register_event",
    note: `${event.name} guests=${imported}`,
  });
  return { eventName: event.name ?? lumaEventId, lumaEventId, guestsImported: imported };
}

export { getEventByLumaId };
