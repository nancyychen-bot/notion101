import { sql } from "./client";
import type { EventCandidate } from "../events/feedback-match";

export interface UpsertVolunteerFeedback {
  ambassadorPageId: string;
  devPageId: string | null;
  eventId: string | null;
  volunteerName: string | null;
  volunteerType: string | null;
  city: string | null;
  tracks: string[];
  preparednessLabel: string | null;
  preparednessScore: number | null;
  experienceLabel: string | null;
  experienceScore: number | null;
  whatWorked: string | null;
  challenges: string | null;
  improvements: string | null;
  submittedAt: string | null;
}

export async function upsertVolunteerFeedback(f: UpsertVolunteerFeedback): Promise<void> {
  await sql`
    insert into volunteer_feedback (
      ambassador_page_id, dev_page_id, event_id, volunteer_name, volunteer_type, city,
      tracks, preparedness_label, preparedness_score, experience_label, experience_score,
      what_worked, challenges, improvements, submitted_at, updated_at)
    values (
      ${f.ambassadorPageId}, ${f.devPageId}, ${f.eventId}, ${f.volunteerName}, ${f.volunteerType}, ${f.city},
      ${f.tracks}, ${f.preparednessLabel}, ${f.preparednessScore}, ${f.experienceLabel}, ${f.experienceScore},
      ${f.whatWorked}, ${f.challenges}, ${f.improvements}, ${f.submittedAt}, now())
    on conflict (ambassador_page_id) do update set
      dev_page_id = excluded.dev_page_id, event_id = excluded.event_id,
      volunteer_name = excluded.volunteer_name, volunteer_type = excluded.volunteer_type, city = excluded.city,
      tracks = excluded.tracks, preparedness_label = excluded.preparedness_label,
      preparedness_score = excluded.preparedness_score, experience_label = excluded.experience_label,
      experience_score = excluded.experience_score, what_worked = excluded.what_worked,
      challenges = excluded.challenges, improvements = excluded.improvements,
      submitted_at = excluded.submitted_at, updated_at = now()
  `;
}

/** The dev mirror page id we last created for this source page, if any. */
export async function getDevPageId(ambassadorPageId: string): Promise<string | null> {
  const rows = (await sql`
    select dev_page_id from volunteer_feedback where ambassador_page_id = ${ambassadorPageId}
  `) as { dev_page_id: string | null }[];
  return rows[0]?.dev_page_id ?? null;
}

/** Candidate events in a city (for City+date attribution). guestId is unused (""). */
export async function eventsInCity(city: string): Promise<EventCandidate[]> {
  const wanted = city.trim();
  if (!wanted) return [];
  const rows = (await sql`
    select e.id as event_id, to_char(e.start_at, 'YYYY-MM-DD') as event_date, e.name as event_name
    from events e
    where e.start_at is not null and lower(e.location) = lower(${wanted})
  `) as { event_id: string; event_date: string; event_name: string | null }[];
  return rows.map((r) => ({ eventId: r.event_id, guestId: "", eventDate: r.event_date }));
}

export interface VolunteerFeedbackRow {
  ambassador_page_id: string;
  event_id: string | null;
  luma_event_id: string | null;
  event_name: string | null;
  volunteer_name: string | null;
  volunteer_type: string | null;
  city: string | null;
  tracks: string[];
  preparedness_label: string | null;
  preparedness_score: number | null;
  experience_label: string | null;
  experience_score: number | null;
  what_worked: string | null;
  challenges: string | null;
  improvements: string | null;
  submitted_at: string | null;
}

export async function listVolunteerFeedback(): Promise<VolunteerFeedbackRow[]> {
  return (await sql`
    select vf.ambassador_page_id, vf.event_id, e.luma_event_id, e.name as event_name,
      vf.volunteer_name, vf.volunteer_type, vf.city, vf.tracks,
      vf.preparedness_label, vf.preparedness_score, vf.experience_label, vf.experience_score,
      vf.what_worked, vf.challenges, vf.improvements, vf.submitted_at
    from volunteer_feedback vf left join events e on e.id = vf.event_id
    order by vf.submitted_at desc nulls last
  `) as never;
}
