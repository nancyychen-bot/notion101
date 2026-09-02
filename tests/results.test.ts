import { describe, it, expect } from "vitest";
import { computeResults, computeCommunity, type EventSummary, type FeedbackRecord } from "../lib/hub/results";

const events: EventSummary[] = [
  { luma_event_id: "nyc", name: "Notion 101 NYC", start_at: "2026-09-29T20:00:00Z", location: "New York", timezone: "America/New_York",
    registered: 10, approved: 8, declined: 1, waitlist: 1, checked_in: 6 },
];
const feedback: FeedbackRecord[] = [
  { luma_event_id: "nyc", satisfaction_score: 5, confidence: "Much more confident", interests: ["Joining a beta"], feature_intent: "DBs", highlight: "Great", respondent_name: "A", respondent_email: "a@x.com", event_name: "Notion 101 NYC" },
  { luma_event_id: "nyc", satisfaction_score: 4, confidence: "Same", interests: ["Joining a beta", "Community"], feature_intent: null, highlight: null, respondent_name: "B", respondent_email: "b@x.com", event_name: "Notion 101 NYC" },
];

describe("computeResults", () => {
  it("computes attendance, satisfaction, confidence, interests per event", () => {
    const { perEvent } = computeResults(events, feedback);
    const r = perEvent[0];
    expect(r.registered).toBe(10);
    expect(r.noShow).toBe(2);
    expect(r.attendanceRate).toBeCloseTo(6 / 8);
    expect(r.responses).toBe(2);
    expect(r.responseRate).toBeCloseTo(2 / 6);
    expect(r.avgSatisfaction).toBeCloseTo(4.5);
    expect(r.satisfactionDist[5]).toBe(1);
    expect(r.confidence.muchMore).toBe(1);
    expect(r.pctMoreConfident).toBeCloseTo(1 / 2);
    expect(r.interests[0]).toEqual({ label: "Joining a beta", count: 2 });
  });

  it("rolls up an overall bucket", () => {
    const { overall } = computeResults(events, feedback);
    expect(overall.key).toBe("__all__");
    expect(overall.responses).toBe(2);
  });

  it("buckets confidence labels correctly, incl. 'somewhat less' as less (not more)", () => {
    const mk = (confidence: string): FeedbackRecord => ({
      luma_event_id: "nyc", satisfaction_score: null, confidence, interests: [],
      feature_intent: null, highlight: null, respondent_name: null, respondent_email: null, event_name: null,
    });
    const fb = [
      mk("Much more confident"),
      mk("Somewhat more confident"),
      mk("About the same"),
      mk("Somewhat less confident"),
      mk("Much less confident"),
    ];
    const { overall } = computeResults(events, fb);
    expect(overall.confidence).toEqual({ muchMore: 1, somewhatMore: 1, same: 1, less: 2, unknown: 0 });
    expect(overall.pctMoreConfident).toBeCloseTo(2 / 5);
  });
});

describe("computeCommunity", () => {
  it("counts repeat attendees across events by email", () => {
    const c = computeCommunity([
      { email: "a@x.com", name: "A", luma_event_id: "nyc" },
      { email: "A@X.com", name: "A", luma_event_id: "sf" },
      { email: "b@x.com", name: "B", luma_event_id: "nyc" },
    ]);
    expect(c.uniqueAttendees).toBe(2);
    expect(c.repeatAttendees).toBe(1);
    expect(c.repeatRate).toBeCloseTo(1 / 2);
  });
});
