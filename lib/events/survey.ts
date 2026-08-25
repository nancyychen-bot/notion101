import { listEvents } from "../db/events";
import { listCheckedInForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";

const HOUR = 3600_000;

/**
 * True if the event ended between `minH` and `maxH` hours before `now`. The
 * survey cron runs hourly; a 2–6h trailing window guarantees exactly one hit
 * per event without double-sending (email_log also dedups).
 */
export function eventEndedInWindow(endIso: string, now: Date, minH = 2, maxH = 6): boolean {
  const ended = new Date(endIso).getTime();
  const delta = now.getTime() - ended;
  return delta >= minH * HOUR && delta < maxH * HOUR;
}

/** Send the survey to checked-in guests of events that ended a few hours ago. */
export async function dispatchSurvey(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    const end = ev.end_at ?? ev.start_at;
    if (!end || !eventEndedInWindow(end, now)) continue;
    for (const g of await listCheckedInForEvent(ev.id)) {
      await sendGuestEmail(g.id, "survey");
      sent++;
    }
  }
  return { sent };
}
