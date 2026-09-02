import { describe, it, expect } from "vitest";
import { parseScore, readVolunteerContent } from "../lib/notion/volunteer-feedback";

const props = {
  "Volunteer name": { type: "title", title: [{ plain_text: "Jamie Rivera" }] },
  "Volunteer type": { type: "select", select: { name: "Ambassador" } },
  "City": { type: "select", select: { name: "New York" } },
  "Track(s) supported": { type: "multi_select", multi_select: [{ name: "Services" }, { name: "E-commerce & Online" }] },
  "Preparedness": { type: "select", select: { name: "4 — Prepared" } },
  "Overall experience": { type: "select", select: { name: "5 — Excellent" } },
  "What worked well": { type: "rich_text", rich_text: [{ plain_text: "Great crowd" }] },
  "Challenges": { type: "rich_text", rich_text: [{ plain_text: "Wifi" }] },
  "Improvements": { type: "rich_text", rich_text: [{ plain_text: "More time" }] },
};

describe("volunteer feedback readers", () => {
  it("parses a leading score from an em-dash label", () => {
    expect(parseScore("5 — Excellent")).toBe(5);
    expect(parseScore("1 — Not prepared")).toBe(1);
    expect(parseScore("")).toBeNull();
    expect(parseScore(null)).toBeNull();
  });

  it("reads full volunteer content", () => {
    expect(readVolunteerContent(props)).toEqual({
      volunteerName: "Jamie Rivera",
      volunteerType: "Ambassador",
      city: "New York",
      tracks: ["Services", "E-commerce & Online"],
      preparednessLabel: "4 — Prepared",
      preparednessScore: 4,
      experienceLabel: "5 — Excellent",
      experienceScore: 5,
      whatWorked: "Great crowd",
      challenges: "Wifi",
      improvements: "More time",
    });
  });
});
