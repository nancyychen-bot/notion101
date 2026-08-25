import { listEvents } from "../db/events";
import { listApprovedForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";
import { isWithinDaysBefore } from "./dates";
import { planSegment } from "../email/segment";
import { QUESTION_MAP } from "../notion/schema";

/** Which reminder window (if any) an event's start warrants relative to `now`. */
export function reminderPlanForEvent(startIso: string, now: Date): "three_day" | "one_day" | null {
  if (isWithinDaysBefore(startIso, now, 3)) return "three_day";
  if (isWithinDaysBefore(startIso, now, 1)) return "one_day";
  return null;
}

/**
 * Send due reminders, segmented by Notion plan:
 *  - 3 days before → upgrade_3d to Free/No-Account guests only
 *  - 1 day before  → reminder_1d_free (Free) / reminder_1d_paid (paid)
 */
export async function dispatchReminders(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    if (!ev.start_at) continue;
    const window = reminderPlanForEvent(ev.start_at, now);
    if (!window) continue;
    for (const g of await listApprovedForEvent(ev.id)) {
      const seg = planSegment(g.answers, QUESTION_MAP);
      if (window === "three_day") {
        if (seg === "free") { await sendGuestEmail(g.id, "upgrade_3d"); sent++; }
      } else {
        await sendGuestEmail(g.id, seg === "free" ? "reminder_1d_free" : "reminder_1d_paid");
        sent++;
      }
    }
  }
  return { sent };
}
