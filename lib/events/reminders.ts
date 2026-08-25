import { listEvents } from "../db/events";
import { listApprovedForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";
import { isWithinDaysBefore } from "./dates";
import type { EmailKind } from "../email/templates";

/** Which reminder (if any) an event's start date warrants relative to `now`. */
export function reminderKindForEvent(startIso: string, now: Date): EmailKind | null {
  if (isWithinDaysBefore(startIso, now, 3)) return "reminder_3d";
  if (isWithinDaysBefore(startIso, now, 1)) return "reminder_1d";
  return null;
}

/** Send the due reminder (3-day or 1-day) to all approved guests. */
export async function dispatchReminders(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    if (!ev.start_at) continue;
    const kind = reminderKindForEvent(ev.start_at, now);
    if (!kind) continue;
    for (const g of await listApprovedForEvent(ev.id)) {
      await sendGuestEmail(g.id, kind);
      sent++;
    }
  }
  return { sent };
}
