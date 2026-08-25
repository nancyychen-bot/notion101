import { describe, it, expect } from "vitest";
import { renderEmail, type EmailKind, type EmailFields } from "../lib/email/templates";

const fields: EmailFields = {
  guestName: "Ada Lovelace",
  eventName: "Notion 101 — NYC",
  eventDate: "Wednesday, August 26",
  location: "Notion HQ",
  surveyUrl: "https://survey.example.com/x",
  freeTrialUrl: "https://www.notion.so/product",
  eventUrl: "https://luma.com/notion101",
};

const kinds: EmailKind[] = ["approved", "decline", "reminder_3d", "reminder_1d", "survey"];

describe("renderEmail", () => {
  it.each(kinds)("renders %s with non-empty subject/html/text", (kind) => {
    const r = renderEmail(kind, fields);
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text).toContain("Ada"); // greets by first name
  });
  it("reminders include the free-trial CTA link", () => {
    for (const k of ["reminder_3d", "reminder_1d"] as EmailKind[]) {
      expect(renderEmail(k, fields).html).toContain(fields.freeTrialUrl);
    }
  });
  it("survey includes the survey link", () => {
    expect(renderEmail("survey", fields).html).toContain(fields.surveyUrl!);
  });
});
