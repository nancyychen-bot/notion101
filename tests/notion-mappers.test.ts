import { describe, it, expect } from "vitest";
import { answersToProperties, readStatusFromPage } from "../lib/notion/mappers";

const qmap = {
  "q-company": { prop: "Company", kind: "rich_text" as const },
  "q-size": { prop: "Company Size", kind: "select" as const },
  "q-why": { prop: "Why Attending", kind: "multi_select" as const },
};

describe("answersToProperties", () => {
  it("builds Notion property values by question kind", () => {
    const props = answersToProperties(
      { "q-company": "Acme", "q-size": "10-50", "q-why": "Learn basics, Organize business" },
      qmap,
    );
    expect(props["Company"]).toEqual({ rich_text: [{ text: { content: "Acme" } }] });
    expect(props["Company Size"]).toEqual({ select: { name: "10-50" } });
    expect(props["Why Attending"]).toEqual({
      multi_select: [{ name: "Learn basics" }, { name: "Organize business" }],
    });
  });
  it("skips unknown question ids and empty answers", () => {
    const props = answersToProperties({ "q-unknown": "x", "q-company": "" }, qmap);
    expect(props).toEqual({});
  });
});

describe("readStatusFromPage", () => {
  it("reads the Status select and lowercases it", () => {
    const page = { properties: { Status: { type: "select", select: { name: "Approved" } } } };
    expect(readStatusFromPage(page)).toBe("approved");
  });
  it("returns null when Status is empty", () => {
    const page = { properties: { Status: { type: "select", select: null } } };
    expect(readStatusFromPage(page)).toBeNull();
  });
});
