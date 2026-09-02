import { sql } from "./client";
import type { EventCandidate } from "../events/feedback-match";

export interface UpsertFeedback {
  notionPageId: string;
  eventId: string | null;
  guestId: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  satisfactionScore: number | null;
  satisfactionLabel: string | null;
  confidence: string | null;
  interests: string[];
  featureIntent: string | null;
  highlight: string | null;
  submittedAt: string | null;
}

export async function upsertFeedback(f: UpsertFeedback): Promise<void> {
  await sql`
    insert into feedback (
      notion_page_id, event_id, guest_id, respondent_name, respondent_email,
      satisfaction_score, satisfaction_label, confidence, interests,
      feature_intent, highlight, submitted_at, updated_at)
    values (
      ${f.notionPageId}, ${f.eventId}, ${f.guestId}, ${f.respondentName}, ${f.respondentEmail},
      ${f.satisfactionScore}, ${f.satisfactionLabel}, ${f.confidence}, ${f.interests},
      ${f.featureIntent}, ${f.highlight}, ${f.submittedAt}, now())
    on conflict (notion_page_id) do update set
      event_id = excluded.event_id, guest_id = excluded.guest_id,
      respondent_name = excluded.respondent_name, respondent_email = excluded.respondent_email,
      satisfaction_score = excluded.satisfaction_score, satisfaction_label = excluded.satisfaction_label,
      confidence = excluded.confidence, interests = excluded.interests,
      feature_intent = excluded.feature_intent, highlight = excluded.highlight,
      submitted_at = excluded.submitted_at, updated_at = now()
  `;
}

type CandRow = { event_id: string; guest_id: string; event_date: string };
const toCand = (rows: CandRow[]): EventCandidate[] =>
  rows.map((r) => ({ eventId: r.event_id, guestId: r.guest_id, eventDate: r.event_date }));

/**
 * Candidate {event,guest} rows whose guest matches the respondent EMAIL — the
 * survey's "What email do you use for Notion?" may differ from the RSVP email,
 * so we match it against `guests.email` OR any value in the guest's `answers`
 * jsonb (which includes their Notion account email). Qid-independent.
 */
export async function candidatesByEmail(email: string): Promise<EventCandidate[]> {
  const wanted = email.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, g.id as guest_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date
    from guests g join events e on e.id = g.event_id
    where e.start_at is not null and (
      lower(g.email) = lower(${wanted})
      or exists (
        select 1 from jsonb_each_text(coalesce(g.answers, '{}'::jsonb)) je
        where lower(je.value) = lower(${wanted})
      )
    )
  `) as CandRow[];
  return toCand(rows);
}

/** Fallback: candidate rows whose guest NAME matches the respondent (case-insensitive). */
export async function candidatesByName(name: string): Promise<EventCandidate[]> {
  const wanted = name.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, g.id as guest_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date
    from guests g join events e on e.id = g.event_id
    where e.start_at is not null and lower(g.name) = lower(${wanted})
  `) as CandRow[];
  return toCand(rows);
}

export interface FeedbackWithEvent {
  notion_page_id: string;
  luma_event_id: string | null;
  event_name: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  satisfaction_score: number | null;
  confidence: string | null;
  interests: string[];
  feature_intent: string | null;
  highlight: string | null;
  submitted_at: string | null;
}

export async function listFeedbackWithEvents(): Promise<FeedbackWithEvent[]> {
  return (await sql`
    select f.notion_page_id, e.luma_event_id, e.name as event_name,
      f.respondent_name, f.respondent_email, f.satisfaction_score, f.confidence,
      f.interests, f.feature_intent, f.highlight, f.submitted_at
    from feedback f left join events e on e.id = f.event_id
    order by f.submitted_at desc nulls last
  `) as never;
}
