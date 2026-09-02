import { describe, it, expect } from "vitest";
import { volunteerSummary, type VolunteerRow } from "../lib/hub/volunteer-summary";

const rows: VolunteerRow[] = [
  { experience_score: 5, preparedness_score: 4, city: "New York" },
  { experience_score: 4, preparedness_score: 2, city: "New York" },
  { experience_score: null, preparedness_score: null, city: "San Francisco" },
];

describe("volunteerSummary", () => {
  it("counts responses and averages non-null scores", () => {
    const s = volunteerSummary(rows);
    expect(s.responses).toBe(3);
    expect(s.avgExperience).toBeCloseTo(4.5);
    expect(s.avgPreparedness).toBeCloseTo(3);
  });
  it("handles no responses", () => {
    const s = volunteerSummary([]);
    expect(s.responses).toBe(0);
    expect(s.avgExperience).toBeNull();
    expect(s.avgPreparedness).toBeNull();
  });
});
