import { describe, it, expect } from "vitest";
import { isoDatePlusDays, isWithinDaysBefore } from "../lib/events/dates";

describe("date helpers", () => {
  it("isoDatePlusDays returns the UTC calendar date N days ahead", () => {
    expect(isoDatePlusDays(new Date("2026-08-24T13:00:00Z"), 1)).toBe("2026-08-25");
    expect(isoDatePlusDays(new Date("2026-08-24T13:00:00Z"), 3)).toBe("2026-08-27");
  });

  it("isWithinDaysBefore is true when the event date is exactly N days from now", () => {
    const now = new Date("2026-08-24T13:00:00Z");
    expect(isWithinDaysBefore("2026-08-27T18:00:00Z", now, 3)).toBe(true);
    expect(isWithinDaysBefore("2026-08-25T18:00:00Z", now, 1)).toBe(true);
    expect(isWithinDaysBefore("2026-08-26T18:00:00Z", now, 1)).toBe(false);
  });
});
