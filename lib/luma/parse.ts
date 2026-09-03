import type { LumaStatus } from "./client";
import { normalizeAnswers } from "./answers";

export interface ParsedGuest {
  type: string;
  lumaEventId: string;
  lumaGuestId: string;
  name: string | null;
  email: string | null;
  lumaStatus: LumaStatus;
  checkedInAt: string | null;
  answers: Record<string, string>;
}

function toStatus(approval: string | null | undefined): LumaStatus {
  switch (approval) {
    case "approved": return "approved";
    case "declined": return "declined";
    case "waitlist": return "waitlist";
    default: return "pending"; // incl. "pending_approval"
  }
}

/** The guest object carried by a Luma webhook (under `data`). Same shape as a
 * guest-list entry plus a nested `event`. Confirmed against a live delivery. */
interface WebhookGuest {
  id?: string;
  api_id?: string;
  user_name?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
  user_email?: string | null;
  approval_status?: string | null;
  checked_in_at?: string | null;
  event_tickets?: { checked_in_at?: string | null }[];
  registration_answers?: { question_id?: string; question_type?: string; value?: unknown; answer?: unknown }[];
  event?: { id?: string; api_id?: string };
}

/** Display name: prefer user_name, else first+last (trimmed), else null. */
function deriveName(g: WebhookGuest): string | null {
  if (g.user_name && g.user_name.trim()) return g.user_name.trim();
  const composed = [g.user_first_name, g.user_last_name]
    .filter((p): p is string => !!p && !!p.trim())
    .join(" ")
    .trim();
  return composed || null;
}

/**
 * Normalize a Luma guest webhook. The real payload is `{ type?, data: <guest> }`
 * where the guest carries its own nested `event`. Guest id is `data.api_id`
 * (== `data.id`), event id is `data.event.api_id`, identity is under
 * `user_name`/`user_email`, check-in comes off the ticket. Returns null if the
 * payload carries no guest.
 */
export function parseGuestWebhook(body: unknown): ParsedGuest | null {
  const b = body as { type?: string; event_type?: string; data?: WebhookGuest };
  const g = b.data;
  if (!g) return null;
  const guestId = g.api_id ?? g.id;
  if (!guestId) return null;

  const checkedInAt =
    g.checked_in_at ??
    (g.event_tickets ?? []).find((t) => t?.checked_in_at)?.checked_in_at ??
    null;

  return {
    type: b.type ?? b.event_type ?? "updated",
    lumaEventId: g.event?.api_id ?? g.event?.id ?? "",
    lumaGuestId: guestId,
    name: deriveName(g),
    email: g.user_email ?? null,
    lumaStatus: toStatus(g.approval_status),
    checkedInAt,
    answers: normalizeAnswers(g.registration_answers ?? []),
  };
}
