/** "City — Mon YYYY", the month/year computed in the event's own timezone. */
export function eventLabel(
  city: string | null | undefined,
  startAtISO: string | null | undefined,
  timezone: string | null | undefined,
): string {
  const place = (city ?? "").trim() || "Online";
  if (!startAtISO) return place;
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
  if (timezone) opts.timeZone = timezone;
  let stamp: string;
  try {
    stamp = new Intl.DateTimeFormat("en-US", opts).format(new Date(startAtISO));
  } catch {
    stamp = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(startAtISO));
  }
  return `${place} — ${stamp}`;
}
