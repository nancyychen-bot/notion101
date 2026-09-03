/** Extract the bare email from a "Name <email>" (or plain email) string. */
export function fromAddressEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// RFC 5545 TEXT escaping.
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface BuildInviteInput {
  uid: string;
  summary: string;
  startsAt: string;        // ISO
  endsAt?: string | null;  // ISO or null
  location?: string | null;
  description?: string | null;
  attendeeEmail: string;
}

/**
 * Build a single VCALENDAR/VEVENT ICS string for one event, as a METHOD:PUBLISH
 * add-to-calendar event (see the body comment for why not REQUEST).
 * If `endsAt` is missing/null/unparseable, defaults to start + 1 hour.
 *
 * @param input      Event fields (uid, summary, startsAt, endsAt, location, description, attendeeEmail)
 * @param fromEmail  ORGANIZER email address (bare, no display name)
 * @param dtstampIso ISO timestamp for DTSTAMP (also drives SEQUENCE)
 */
export function buildInvite(
  input: BuildInviteInput,
  fromEmail: string,
  dtstampIso: string,
): string {
  const start = new Date(input.startsAt);
  const endDate =
    input.endsAt && !Number.isNaN(new Date(input.endsAt).getTime())
      ? new Date(input.endsAt)
      : new Date(start.getTime() + 60 * 60_000); // default: start + 1 hour
  // Monotonic SEQUENCE from the stamp time so a re-send always increases;
  // calendar clients ignore a lower/equal sequence for the same UID.
  const seq = Math.max(0, Math.floor(new Date(dtstampIso).getTime() / 1000));

  // METHOD:PUBLISH (add-to-calendar), NOT REQUEST (invitation): with PUBLISH +
  // RSVP=FALSE the attendee's calendar does NOT email an RSVP reply to the
  // ORGANIZER on accept/decline. Our From is a send-only noreply mailbox that
  // 550-bounces those replies back to the guest. Same fix as office-hours; the
  // content-type method (inviteAttachment) must also be PUBLISH to match.
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Notion 101//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${esc(input.uid)}`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${stamp(dtstampIso)}`,
    `DTSTART:${stamp(start.toISOString())}`,
    `DTEND:${stamp(endDate.toISOString())}`,
    `SUMMARY:${esc(input.summary)}`,
    input.location ? `LOCATION:${esc(input.location)}` : null,
    input.description ? `DESCRIPTION:${esc(input.description)}` : null,
    `ORGANIZER;CN=Notion 101:mailto:${fromEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${input.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter((l): l is string => l !== null).join("\r\n");
}

/**
 * Wrap ICS text as an email attachment. The content-type MUST carry the METHOD
 * (REQUEST/CANCEL/PUBLISH) and match the VCALENDAR body's METHOD so mail
 * clients render a real Add-to-Calendar rather than a generic file.
 */
export function inviteAttachment(
  ics: string,
  method: string,
): { filename: string; content: Buffer; contentType: string } {
  return {
    filename: "invite.ics",
    content: Buffer.from(ics, "utf8"),
    contentType: `text/calendar; method=${method}; charset=utf-8`,
  };
}
