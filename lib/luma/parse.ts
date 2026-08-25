import type { LumaStatus } from "./client";

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

// NOTE: field names (event.api_id, guest.api_id, registration_answers[].answer) are provisional; confirm against a captured live Luma webhook during deploy validation.
/** Normalize a Luma guest webhook. Returns null if it carries no guest. */
export function parseGuestWebhook(body: unknown): ParsedGuest | null {
  const b = body as {
    type?: string;
    event?: { api_id?: string };
    guest?: {
      api_id?: string; name?: string; email?: string;
      approval_status?: string; checked_in_at?: string | null;
      registration_answers?: { question_id?: string; answer?: unknown }[];
    };
  };
  const guest = b.guest;
  if (!guest?.api_id) return null;
  const answers: Record<string, string> = {};
  for (const a of guest.registration_answers ?? []) {
    if (a.question_id != null) answers[a.question_id] = String(a.answer ?? "");
  }
  return {
    type: b.type ?? "unknown",
    lumaEventId: b.event?.api_id ?? "",
    lumaGuestId: guest.api_id,
    name: guest.name ?? null,
    email: guest.email ?? null,
    lumaStatus: toStatus(guest.approval_status),
    checkedInAt: guest.checked_in_at ?? null,
    answers,
  };
}
