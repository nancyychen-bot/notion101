import { describe, it, expect } from "vitest";
import { parseGuestWebhook } from "../lib/luma/parse";

const payload = {
  type: "guest.updated",
  event: { api_id: "evt-abc" },
  guest: {
    api_id: "gst-123",
    name: "Ada Lovelace",
    email: "ada@example.com",
    approval_status: "pending_approval",
    checked_in_at: null,
    registration_answers: [
      { question_id: "q-company", answer: "Analytical Engines Inc" },
      { question_id: "q-size", answer: "10-50" },
    ],
  },
};

describe("parseGuestWebhook", () => {
  it("normalizes a guest.updated payload", () => {
    const g = parseGuestWebhook(payload);
    expect(g).toEqual({
      type: "guest.updated",
      lumaEventId: "evt-abc",
      lumaGuestId: "gst-123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      lumaStatus: "pending",
      checkedInAt: null,
      answers: { "q-company": "Analytical Engines Inc", "q-size": "10-50" },
    });
  });

  it("maps approval_status variants to hub statuses", () => {
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "approved" } })!.lumaStatus).toBe("approved");
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "declined" } })!.lumaStatus).toBe("declined");
    expect(parseGuestWebhook({ ...payload, guest: { ...payload.guest, approval_status: "waitlist" } })!.lumaStatus).toBe("waitlist");
  });

  it("returns null when there is no guest", () => {
    expect(parseGuestWebhook({ type: "ping" })).toBeNull();
  });
});
