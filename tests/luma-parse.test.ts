import { describe, it, expect } from "vitest";
import { parseGuestWebhook } from "../lib/luma/parse";

// Mirrors the real Luma webhook shape captured from a live delivery: the guest is
// under `data`, carries its own nested `event`, and identity is user_name/user_email.
const payload = {
  type: "guest.registered",
  data: {
    id: "gst-123",
    api_id: "gst-123",
    event: { id: "evt-abc", api_id: "evt-abc" },
    user_name: "Ada Lovelace",
    user_first_name: "Ada",
    user_last_name: "Lovelace",
    user_email: "ada@example.com",
    approval_status: "pending_approval",
    checked_in_at: null,
    event_tickets: [{ checked_in_at: null }],
    registration_answers: [
      { question_id: "nhidmktb", question_type: "company", value: { company: "Analytical Engines Inc", job_title: "Lead" } },
      { question_id: "by766naw", value: "10-50" },
    ],
  },
};

describe("parseGuestWebhook", () => {
  it("normalizes a real (data-wrapped) guest payload", () => {
    expect(parseGuestWebhook(payload)).toEqual({
      type: "guest.registered",
      lumaEventId: "evt-abc",
      lumaGuestId: "gst-123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      lumaStatus: "pending",
      checkedInAt: null,
      answers: {
        nhidmktb: "Analytical Engines Inc",
        "nhidmktb::job_title": "Lead",
        by766naw: "10-50",
      },
    });
  });

  it("maps approval_status variants to hub statuses", () => {
    const s = (status: string) => parseGuestWebhook({ ...payload, data: { ...payload.data, approval_status: status } })!.lumaStatus;
    expect(s("approved")).toBe("approved");
    expect(s("declined")).toBe("declined");
    expect(s("waitlist")).toBe("waitlist");
    expect(s("pending_approval")).toBe("pending");
  });

  it("derives name from first+last when user_name is absent", () => {
    const g = parseGuestWebhook({ data: { ...payload.data, user_name: null } });
    expect(g!.name).toBe("Ada Lovelace");
  });

  it("reads check-in off the ticket", () => {
    const g = parseGuestWebhook({ data: { ...payload.data, event_tickets: [{ checked_in_at: "2026-01-01T00:00:00Z" }] } });
    expect(g!.checkedInAt).toBe("2026-01-01T00:00:00Z");
  });

  it("returns null when there is no guest data", () => {
    expect(parseGuestWebhook({ type: "ping" })).toBeNull();
    expect(parseGuestWebhook({ data: {} })).toBeNull();
  });
});
