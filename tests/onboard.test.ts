import { describe, it, expect } from "vitest";
import { deriveCalendarId } from "../lib/events/onboard";

describe("deriveCalendarId", () => {
  it("normalizes the first usable candidate", () => {
    expect(deriveCalendarId("Korea", "Seoul", "cal-9")).toBe("korea");
    expect(deriveCalendarId("New York City", null, null)).toBe("new-york-city");
  });
  it("skips candidates that normalize to empty and falls through", () => {
    expect(deriveCalendarId("!!!", "Seoul", "cal-9")).toBe("seoul");
    expect(deriveCalendarId("", "   ", "cal-9")).toBe("cal-9");
  });
  it("never returns empty", () => {
    expect(deriveCalendarId(null, undefined, "")).toBe("calendar");
  });
});
