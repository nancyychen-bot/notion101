import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LumaCalendarRow } from "../lib/db/luma-calendars";

// Mock the DB layer so we control what "the table" returns.
const listMock = vi.fn<[], Promise<LumaCalendarRow[]>>();
vi.mock("../lib/db/luma-calendars", () => ({
  listLumaCalendarRows: () => listMock(),
}));

import {
  lumaCalendars,
  apiKeyForCalendar,
  lumaWebhookSecrets,
  calendarUrlForCalendar,
  __bustCalendarCache,
} from "../lib/luma/calendars";

const OLD = process.env;
beforeEach(() => {
  process.env = { ...OLD };
  listMock.mockReset();
  __bustCalendarCache();
});
afterEach(() => {
  process.env = OLD;
});

describe("lumaCalendars", () => {
  it("seeds a 'default' calendar from env and lets DB rows override by id", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockResolvedValue([
      { id: "default", apiKey: "db-default", webhookSecret: "db-whsec", calendarId: "cal-1", city: null, calendarUrl: null },
      { id: "korea", apiKey: "db-korea", webhookSecret: "whsec-korea", calendarId: "cal-2", city: "Seoul", calendarUrl: "https://luma.com/notion-korea" },
    ]);
    const cals = await lumaCalendars();
    expect(cals.find((c) => c.id === "default")?.apiKey).toBe("db-default"); // DB wins
    expect(cals.find((c) => c.id === "korea")?.apiKey).toBe("db-korea");
  });

  it("fails open to env when the DB read throws", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockRejectedValue(new Error("db down"));
    const cals = await lumaCalendars();
    expect(cals).toEqual([{ id: "default", apiKey: "env-default", webhookSecret: "env-whsec" }]);
  });
});

describe("apiKeyForCalendar", () => {
  it("returns the default key for null/empty id", async () => {
    process.env.LUMA_API_KEY = "env-default";
    listMock.mockResolvedValue([]);
    expect(await apiKeyForCalendar(null)).toBe("env-default");
    expect(await apiKeyForCalendar("")).toBe("env-default");
  });

  it("throws for an unknown calendar", async () => {
    listMock.mockResolvedValue([]);
    await expect(apiKeyForCalendar("nope")).rejects.toThrow(/Unknown Luma calendar/);
  });
});

describe("lumaWebhookSecrets", () => {
  it("collects every non-null secret across env + DB", async () => {
    process.env.LUMA_API_KEY = "env-default";
    process.env.LUMA_WEBHOOK_SECRET = "env-whsec";
    listMock.mockResolvedValue([
      { id: "korea", apiKey: "k", webhookSecret: "whsec-korea", calendarId: null, city: null, calendarUrl: null },
      { id: "london", apiKey: "k2", webhookSecret: null, calendarId: null, city: null, calendarUrl: null },
    ]);
    const secrets = await lumaWebhookSecrets();
    expect(secrets.sort()).toEqual(["env-whsec", "whsec-korea"]);
  });
});

describe("calendarUrlForCalendar", () => {
  it("returns the DB row's url, else null", async () => {
    listMock.mockResolvedValue([
      { id: "korea", apiKey: "k", webhookSecret: null, calendarId: null, city: null, calendarUrl: "https://luma.com/notion-korea" },
    ]);
    expect(await calendarUrlForCalendar("korea")).toBe("https://luma.com/notion-korea");
    expect(await calendarUrlForCalendar("default")).toBeNull();
  });
});
