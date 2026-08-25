import { describe, it, expect } from "vitest";
import { reminderPlanForEvent } from "../lib/events/reminders";

const now = new Date("2026-12-15T12:00:00Z");

describe("reminderPlanForEvent", () => {
  it("returns upgrade_3d window 3 days out", () => {
    // event starts 2026-12-18 → 3 days before 12-15
    expect(reminderPlanForEvent("2026-12-18T19:00:00Z", now)).toBe("three_day");
  });
  it("returns one_day window 1 day out", () => {
    expect(reminderPlanForEvent("2026-12-16T19:00:00Z", now)).toBe("one_day");
  });
  it("returns null otherwise", () => {
    expect(reminderPlanForEvent("2026-12-25T19:00:00Z", now)).toBeNull();
  });
});
