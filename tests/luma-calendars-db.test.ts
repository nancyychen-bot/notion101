import { describe, it, expect } from "vitest";
import { mapCalendarRow } from "../lib/db/luma-calendars";

describe("mapCalendarRow", () => {
  it("maps snake_case DB columns to camelCase", () => {
    expect(
      mapCalendarRow({
        id: "korea",
        api_key: "secret-abc",
        webhook_secret: "whsec-1",
        calendar_id: "cal-9",
        city: "Seoul",
        calendar_url: "https://luma.com/notion-korea",
      }),
    ).toEqual({
      id: "korea",
      apiKey: "secret-abc",
      webhookSecret: "whsec-1",
      calendarId: "cal-9",
      city: "Seoul",
      calendarUrl: "https://luma.com/notion-korea",
    });
  });

  it("preserves nulls", () => {
    expect(
      mapCalendarRow({ id: "x", api_key: "k", webhook_secret: null, calendar_id: null, city: null, calendar_url: null }),
    ).toMatchObject({ webhookSecret: null, calendarId: null, city: null, calendarUrl: null });
  });
});
