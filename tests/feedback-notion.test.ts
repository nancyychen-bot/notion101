import { describe, it, expect } from "vitest";
import { parseSatisfactionScore, readFeedbackContent, readFeedbackEmail, readFeedbackName } from "../lib/notion/feedback";

const props = {
  "What is your name?": { type: "rich_text", rich_text: [{ plain_text: "Ada Lovelace" }] },
  "What email do you use for Notion?": { type: "email", email: "ada@example.com" },
  "How satisfied were you with this event?": { type: "select", select: { name: "5 - Amazing" } },
  "How confident are you using Notion after this event vs. before?": { type: "select", select: { name: "Much more confident" } },
  "Would you be interested in any of these?": { type: "multi_select", multi_select: [{ name: "Joining a beta" }, { name: "Creating a template" }] },
  "Which feature or workflow will you try this week?": { type: "rich_text", rich_text: [{ plain_text: "Databases" }] },
  "What was the highlight, and anything we should improve?": { type: "rich_text", rich_text: [{ plain_text: "Great session" }] },
};

describe("feedback notion readers", () => {
  it("parses the leading integer of a satisfaction label", () => {
    expect(parseSatisfactionScore("5 - Amazing")).toBe(5);
    expect(parseSatisfactionScore("2 - Meh")).toBe(2);
    expect(parseSatisfactionScore("")).toBeNull();
    expect(parseSatisfactionScore(null)).toBeNull();
  });

  it("reads name + email", () => {
    expect(readFeedbackName(props)).toBe("Ada Lovelace");
    expect(readFeedbackEmail(props)).toBe("ada@example.com");
  });

  it("reads full feedback content", () => {
    expect(readFeedbackContent(props)).toEqual({
      satisfactionLabel: "5 - Amazing",
      satisfactionScore: 5,
      confidence: "Much more confident",
      interests: ["Joining a beta", "Creating a template"],
      featureIntent: "Databases",
      highlight: "Great session",
    });
  });
});
