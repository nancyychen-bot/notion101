import { describe, it, expect } from "vitest";
import { normalizeAnswers } from "../lib/luma/answers";

describe("normalizeAnswers", () => {
  it("extracts company and job_title from the compound company answer", () => {
    const out = normalizeAnswers([
      { question_id: "nhidmktb", question_type: "company", value: { company: "Notion", job_title: "Experiential Lead" } },
    ]);
    expect(out).toEqual({ nhidmktb: "Notion", "nhidmktb::job_title": "Experiential Lead" });
  });

  it("joins multi-select arrays with commas", () => {
    const out = normalizeAnswers([
      { question_id: "lxz8zp1m", question_type: "multi-select", value: ["Organize", "Automate"] },
    ]);
    expect(out).toEqual({ lxz8zp1m: "Organize, Automate" });
  });

  it("passes scalar values through and prefers value over answer", () => {
    const out = normalizeAnswers([
      { question_id: "by766naw", value: "10-50" },
      { question_id: "q-fallback", answer: "from-answer" },
    ]);
    expect(out).toEqual({ by766naw: "10-50", "q-fallback": "from-answer" });
  });

  it("stores empty string for null/empty values and skips id-less entries", () => {
    const out = normalizeAnswers([
      { question_id: "1uc5woee", value: "" },
      { question_id: "x", value: null },
      { value: "orphan" },
    ]);
    expect(out).toEqual({ "1uc5woee": "", x: "" });
  });
});
