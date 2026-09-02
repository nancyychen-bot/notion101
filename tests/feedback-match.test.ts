import { describe, it, expect } from "vitest";
import { selectEventForFeedback } from "../lib/events/feedback-match";

describe("feedback matching", () => {
  it("uses the single matched event even when feedback arrives weeks later", () => {
    const cands = [{ eventId: "nyc", guestId: "g1", eventDate: "2026-09-01" }];
    expect(selectEventForFeedback(cands, "2026-09-22T10:00:00Z")?.eventId).toBe("nyc");
  });

  it("for a repeat attendee, picks the most recent event on/before submission", () => {
    const cands = [
      { eventId: "nyc", guestId: "g1", eventDate: "2026-08-01" },
      { eventId: "sf", guestId: "g2", eventDate: "2026-08-27" },
      { eventId: "future", guestId: "g3", eventDate: "2026-09-05" },
    ];
    expect(selectEventForFeedback(cands, "2026-08-28T10:00:00Z")?.eventId).toBe("sf");
  });

  it("returns null when there are no candidates", () => {
    expect(selectEventForFeedback([], "2026-08-28T10:00:00Z")).toBeNull();
  });

  it("falls back to the earliest event if every candidate is dated after submission", () => {
    const cands = [
      { eventId: "a", guestId: "g1", eventDate: "2026-09-10" },
      { eventId: "b", guestId: "g2", eventDate: "2026-09-20" },
    ];
    expect(selectEventForFeedback(cands, "2026-09-01T10:00:00Z")?.eventId).toBe("a");
  });
});
