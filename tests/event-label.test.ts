import { describe, it, expect } from "vitest";
import { eventLabel } from "../lib/hub/format";

describe("eventLabel", () => {
  it("labels City — Mon YYYY in the event timezone", () => {
    expect(eventLabel("New York", "2026-09-29T20:00:00.000Z", "America/New_York")).toBe("New York — Sep 2026");
  });

  it("uses the event's own tz so a UTC-evening event reads as the local day", () => {
    // 2026-08-31T23:00:00Z is Sep 1 in Sydney (UTC+10)
    expect(eventLabel("Sydney", "2026-08-31T23:00:00.000Z", "Australia/Sydney")).toBe("Sydney — Sep 2026");
  });

  it("falls back to Online when city is missing", () => {
    expect(eventLabel(null, "2026-09-29T20:00:00.000Z", null)).toBe("Online — Sep 2026");
  });

  it("returns just the city when date is missing", () => {
    expect(eventLabel("Austin", null, null)).toBe("Austin");
  });
});
