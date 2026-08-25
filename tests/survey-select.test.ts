import { describe, it, expect } from "vitest";
import { eventEndedInWindow } from "../lib/events/survey";

describe("eventEndedInWindow", () => {
  const now = new Date("2026-08-24T20:00:00Z");
  it("true when the event ended within the trailing window (default 2–6h ago)", () => {
    expect(eventEndedInWindow("2026-08-24T16:00:00Z", now)).toBe(true); // 4h ago
  });
  it("false when it ended too recently", () => {
    expect(eventEndedInWindow("2026-08-24T19:30:00Z", now)).toBe(false); // 0.5h ago
  });
  it("false when it ended too long ago", () => {
    expect(eventEndedInWindow("2026-08-24T10:00:00Z", now)).toBe(false); // 10h ago
  });
});
