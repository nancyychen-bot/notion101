import type { GuestRow } from "../db/guests";
import type { LumaStatus } from "../luma/client";
import type { EmailKind } from "../email/templates";

export interface ApplyStatusDeps {
  setLumaStatus: (id: string, s: LumaStatus) => Promise<GuestRow | null>;
  updateGuestOnLuma: (eventLumaId: string, guestLumaId: string, s: LumaStatus) => Promise<void>;
  sendEmail: (guestId: string, kind: EmailKind) => Promise<void>;
  pushToNotion: (g: GuestRow) => Promise<void>;
  getEventLumaId: (eventId: string) => Promise<string | null>;
  log: (e: { action: string; note?: string; error?: boolean }) => Promise<void>;
}

/** Email kind to send for a status transition (none for waitlist/pending). */
const EMAIL_FOR: Partial<Record<LumaStatus, EmailKind>> = {
  approved: "approved",
  declined: "decline",
};

/**
 * Apply a status change originating in Notion or a cron: push to Luma, persist,
 * send the guest email, and mirror the canonical state back to Notion. Best-effort.
 */
export async function applyStatus(
  guest: GuestRow, next: LumaStatus, deps: ApplyStatusDeps,
): Promise<void> {
  if (guest.luma_status === next) return;

  const eventLumaId = await deps.getEventLumaId(guest.event_id);
  if (eventLumaId) {
    try {
      await deps.updateGuestOnLuma(eventLumaId, guest.luma_guest_id, next);
    } catch (err) {
      await deps.log({ action: `luma_update:${next}`, note: err instanceof Error ? err.message : String(err), error: true });
    }
  }
  const updated = (await deps.setLumaStatus(guest.id, next)) ?? { ...guest, luma_status: next };

  const kind = EMAIL_FOR[next];
  if (kind) await deps.sendEmail(updated.id, kind);

  await deps.pushToNotion(updated);
  await deps.log({ action: `status:${next}` });
}

// ── Default deps wiring ──────────────────────────────────────────────────────

import { setLumaStatus } from "../db/guests";
import { getEventById } from "../db/events";
import { updateGuestStatus } from "../luma/client";
import { sendGuestEmail } from "../email/comms";
import { pushGuestToNotion } from "../notion/push";
import { logSync } from "../db/sync-log";

export function defaultApplyDeps(direction: string, guestId: string): ApplyStatusDeps {
  return {
    setLumaStatus,
    updateGuestOnLuma: (eventLumaId, guestLumaId, s) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: s }),
    sendEmail: (id, kind) => sendGuestEmail(id, kind),
    pushToNotion: async (g) => {
      const ev = await getEventById(g.event_id);
      await pushGuestToNotion(g, ev);
    },
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: (e) => logSync({ direction, result: e.error ? "error" : "applied", guestId, action: e.action, note: e.note }),
  };
}
