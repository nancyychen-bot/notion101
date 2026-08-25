import { listEvents, getEventById } from "../db/events";
import { listGuestsForEvent, type GuestRow } from "../db/guests";
import { applyStatus, defaultApplyDeps } from "./apply-status";
import { isWithinDaysBefore } from "./dates";

export function selectDeclinablePendings(guests: GuestRow[]): GuestRow[] {
  return guests.filter((g) => g.luma_status === "pending");
}

/** Decline every still-pending guest for events happening tomorrow. */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const events = (await listEvents()).filter(
    (e) => e.start_at && isWithinDaysBefore(e.start_at, now, 1),
  );
  let guests = 0;
  for (const ev of events) {
    const pendings = selectDeclinablePendings(await listGuestsForEvent(ev.id));
    for (const g of pendings) {
      await applyStatus(g, "declined", defaultApplyDeps("cron", g.id));
      guests++;
    }
  }
  return { events: events.length, guests };
}

export { getEventById };
