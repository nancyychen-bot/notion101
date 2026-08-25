import { describe, it, expect } from "vitest";
import { TEMPLATE_REGISTRY, renderKind, buildVars, SAMPLE_FIELDS, type EmailKind } from "../lib/email/templates";

const KINDS: EmailKind[] = ["approved", "decline", "upgrade_3d", "reminder_1d_free", "reminder_1d_paid", "feedback"];

describe("TEMPLATE_REGISTRY", () => {
  it("has every kind with audience + when labels", () => {
    for (const k of KINDS) {
      expect(TEMPLATE_REGISTRY[k]).toBeTruthy();
      expect(TEMPLATE_REGISTRY[k].audience.length).toBeGreaterThan(0);
      expect(TEMPLATE_REGISTRY[k].when.length).toBeGreaterThan(0);
    }
  });
});

describe("buildVars", () => {
  it("derives firstName and maps links", () => {
    const v = buildVars({ ...SAMPLE_FIELDS, guestName: "Ada Lovelace" });
    expect(v.firstName).toBe("Ada");
    expect(v.trialLink).toBe(SAMPLE_FIELDS.freeTrialUrl);
  });
});

describe("renderKind", () => {
  it("renders the default subject/body for a kind", () => {
    const r = renderKind("feedback", { ...SAMPLE_FIELDS, guestName: "Ada" });
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html).toContain("Ada");
  });

  it("prefers a published override over the default", () => {
    const overrides = new Map([["feedback", { subject: "Custom subj", body: "Custom **body**" }]]);
    const r = renderKind("feedback", { ...SAMPLE_FIELDS, guestName: "Ada" }, overrides);
    expect(r.subject).toBe("Custom subj");
    expect(r.html).toContain("<strong>body</strong>");
  });
});
