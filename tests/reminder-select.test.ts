import { describe, it, expect } from "vitest";
import { reminderKindForEvent } from "../lib/events/reminders";

describe("reminderKindForEvent", () => {
  const now = new Date("2026-08-24T15:00:00Z");
  it("returns reminder_3d for an event 3 days out", () => {
    expect(reminderKindForEvent("2026-08-27T18:00:00Z", now)).toBe("reminder_3d");
  });
  it("returns reminder_1d for an event 1 day out", () => {
    expect(reminderKindForEvent("2026-08-25T18:00:00Z", now)).toBe("reminder_1d");
  });
  it("returns null otherwise", () => {
    expect(reminderKindForEvent("2026-08-26T18:00:00Z", now)).toBeNull();
  });
});
