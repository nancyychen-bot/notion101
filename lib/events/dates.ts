/** UTC calendar date (YYYY-MM-DD) N days after `now`. */
export function isoDatePlusDays(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True if `eventStartIso` falls on the UTC calendar date exactly `days` ahead of `now`. */
export function isWithinDaysBefore(eventStartIso: string, now: Date, days: number): boolean {
  return eventStartIso.slice(0, 10) === isoDatePlusDays(now, days);
}
