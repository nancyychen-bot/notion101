import { getGuestById } from "../db/guests";
import { getEventById } from "../db/events";
import { reserveCommsSlot, finalizeComms } from "../db/email-log";
import { sendEmail } from "./resend";
import { buildInvite, inviteAttachment, fromAddressEmail } from "./ics";
import { renderKind, type EmailKind, type EmailFields } from "./templates";
import { getLiveOverrideMap } from "../db/email-overrides";
import { logSync } from "../db/sync-log";
import { env } from "../env";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
    });
  } catch { return null; }
}

/**
 * Send one email to a guest for `kind`. Idempotent via email_log (guest,kind,email).
 * Best-effort: never throws. Attaches an event .ics on `approved`.
 */
export async function sendGuestEmail(guestId: string, kind: EmailKind): Promise<void> {
  try {
    const g = await getGuestById(guestId);
    if (!g?.email) return;
    const ev = await getEventById(g.event_id);
    const fields: EmailFields = {
      guestName: g.name,
      eventName: ev?.name ?? null,
      eventDate: formatDate(ev?.start_at ?? null),
      location: null,
      surveyUrl: ev?.survey_url ?? env.app.surveyUrl() ?? null,
      freeTrialUrl: env.app.freeTrialUrl(),
      eventUrl: ev?.public_url ?? null,
    };
    const overrides = await getLiveOverrideMap();
    const rendered = renderKind(kind, fields, overrides);

    let attachments: ReturnType<typeof inviteAttachment>[] | undefined;
    if (kind === "approved" && ev?.start_at) {
      const ics = buildInvite(
        {
          uid: `${g.id}@notion101`,
          summary: ev.name ?? "Notion 101",
          startsAt: ev.start_at,
          endsAt: ev.end_at,
          location: ev.public_url,
          description: rendered.text,
          attendeeEmail: g.email,
        },
        fromAddressEmail(env.comms.from()),
        new Date().toISOString(),
      );
      if (ics) attachments = [inviteAttachment(ics, "PUBLISH")];
    }

    if (!(await reserveCommsSlot(g.id, kind, g.email))) return;
    if (!env.comms.enabled()) {
      await finalizeComms(g.id, kind, g.email, { resendId: null, status: "skipped" });
      return;
    }
    try {
      const { id } = await sendEmail({
        to: g.email, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments,
      });
      if (!id) throw new Error("Resend returned no id");
      await finalizeComms(g.id, kind, g.email, { resendId: id, status: "sent" });
    } catch (err) {
      await finalizeComms(g.id, kind, g.email, { resendId: null, status: "failed" });
      await logSync({ direction: "cron", result: "error", guestId: g.id, action: `email_${kind}`, note: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    await logSync({ direction: "cron", result: "error", guestId, action: `email_${kind}`, note: err instanceof Error ? err.message : String(err) });
  }
}
