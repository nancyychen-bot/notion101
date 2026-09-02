export interface EventSummary {
  luma_event_id: string;
  name: string | null;
  start_at: string | null;
  location: string | null;
  timezone: string | null;
  registered: number;
  approved: number;
  declined: number;
  waitlist: number;
  checked_in: number;
}

export interface FeedbackRecord {
  luma_event_id: string | null;
  satisfaction_score: number | null;
  confidence: string | null;
  interests: string[];
  feature_intent: string | null;
  highlight: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  event_name: string | null;
}

export interface EventResult {
  key: string; // luma_event_id ("__all__" for overall)
  registered: number;
  approved: number;
  checkedIn: number;
  noShow: number;
  waitlist: number;
  attendanceRate: number;
  responses: number;
  responseRate: number;
  avgSatisfaction: number | null;
  satisfactionDist: Record<1 | 2 | 3 | 4 | 5, number>;
  confidence: { muchMore: number; somewhatMore: number; same: number; less: number; unknown: number };
  pctMoreConfident: number | null;
  interests: Array<{ label: string; count: number }>;
  comments: Array<{ name: string | null; featureIntent: string | null; highlight: string | null }>;
}

function rollup(feedback: FeedbackRecord[]) {
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const f of feedback) {
    const s = f.satisfaction_score;
    if (s && s >= 1 && s <= 5) dist[s as 1 | 2 | 3 | 4 | 5]++;
  }
  const scores = feedback.map((f) => f.satisfaction_score).filter((n): n is number => n != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const conf = { muchMore: 0, somewhatMore: 0, same: 0, less: 0, unknown: 0 };
  for (const f of feedback) {
    const c = (f.confidence ?? "").toLowerCase();
    // Check the "more" cases before "less"/"same" so "somewhat less confident"
    // is never miscounted as more. "less" covers "much less" + "somewhat less".
    if (c.includes("much more")) conf.muchMore++;
    else if (c.includes("somewhat more")) conf.somewhatMore++;
    else if (c.includes("less")) conf.less++;
    else if (c.includes("same")) conf.same++;
    else conf.unknown++;
  }
  const answered = conf.muchMore + conf.somewhatMore + conf.same + conf.less;
  const pctMoreConfident = answered > 0 ? (conf.muchMore + conf.somewhatMore) / answered : null;

  const counts = new Map<string, number>();
  for (const f of feedback) for (const i of f.interests) counts.set(i, (counts.get(i) ?? 0) + 1);
  const interests = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  const comments = feedback
    .filter((f) => f.feature_intent || f.highlight)
    .map((f) => ({ name: f.respondent_name, featureIntent: f.feature_intent, highlight: f.highlight }));

  return { dist, avg, conf, pctMoreConfident, interests, comments, responses: feedback.length };
}

function build(key: string, e: Pick<EventSummary, "registered" | "approved" | "checked_in" | "waitlist">, feedback: FeedbackRecord[]): EventResult {
  const f = rollup(feedback);
  const noShow = Math.max(0, e.approved - e.checked_in);
  return {
    key,
    registered: e.registered,
    approved: e.approved,
    checkedIn: e.checked_in,
    noShow,
    waitlist: e.waitlist,
    attendanceRate: e.approved > 0 ? e.checked_in / e.approved : 0,
    responses: f.responses,
    responseRate: e.checked_in > 0 ? f.responses / e.checked_in : 0,
    avgSatisfaction: f.avg,
    satisfactionDist: f.dist,
    confidence: f.conf,
    pctMoreConfident: f.pctMoreConfident,
    interests: f.interests,
    comments: f.comments,
  };
}

export function computeResults(
  events: EventSummary[],
  feedback: FeedbackRecord[],
): { overall: EventResult; perEvent: EventResult[]; unattributed: number } {
  const perEvent = events.map((e) =>
    build(e.luma_event_id, e, feedback.filter((f) => f.luma_event_id === e.luma_event_id)),
  );
  const sum = (pick: (e: EventSummary) => number) => events.reduce((a, e) => a + pick(e), 0);
  const overallSummary = {
    registered: sum((e) => e.registered),
    approved: sum((e) => e.approved),
    checked_in: sum((e) => e.checked_in),
    waitlist: sum((e) => e.waitlist),
  };
  const overall = build("__all__", overallSummary, feedback);
  const unattributed = feedback.filter((f) => !f.luma_event_id).length;
  return { overall, perEvent, unattributed };
}

export interface AttendeeRow {
  email: string | null;
  name: string | null;
  luma_event_id: string;
}
export interface Community {
  uniqueAttendees: number;
  repeatAttendees: number;
  repeatRate: number;
  top: Array<{ email: string; name: string | null; events: number }>;
}

/** Repeat attendance: checked-in attendees grouped by email; ≥2 distinct events = repeat. */
export function computeCommunity(attendees: AttendeeRow[]): Community {
  const byEmail = new Map<string, { name: string | null; events: Set<string> }>();
  for (const a of attendees) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const rec = byEmail.get(email) ?? { name: a.name ?? null, events: new Set<string>() };
    rec.events.add(a.luma_event_id);
    byEmail.set(email, rec);
  }
  const people = [...byEmail.entries()].map(([email, r]) => ({ email, name: r.name, events: r.events.size }));
  const uniqueAttendees = people.length;
  const repeatAttendees = people.filter((p) => p.events >= 2).length;
  return {
    uniqueAttendees,
    repeatAttendees,
    repeatRate: uniqueAttendees > 0 ? repeatAttendees / uniqueAttendees : 0,
    top: people.filter((p) => p.events >= 2).sort((a, b) => b.events - a.events).slice(0, 10),
  };
}
