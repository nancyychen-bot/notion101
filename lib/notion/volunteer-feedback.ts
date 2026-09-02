import { getAmbassadorNotionClient } from "./client";
import { env } from "../env";

/** Property names pinned from the live Ambassador "Notion 101 Volunteer Feedback" schema. */
export const VF = {
  name: "Volunteer name",
  type: "Volunteer type",
  city: "City",
  tracks: "Track(s) supported",
  preparedness: "Preparedness",
  experience: "Overall experience",
  whatWorked: "What worked well",
  challenges: "Challenges",
  improvements: "Improvements",
} as const;

/** Dev mirror property names (superset: content + scores + attribution + idempotency). */
export const VF_DEV = {
  name: "Volunteer name",
  type: "Volunteer type",
  city: "City",
  tracks: "Track(s) supported",
  preparedness: "Preparedness",
  preparednessScore: "Preparedness score",
  experience: "Overall experience",
  experienceScore: "Experience score",
  whatWorked: "What worked well",
  challenges: "Challenges",
  improvements: "Improvements",
  submitted: "Submitted",
  event: "Event",
  eventDate: "Event Date",
  ambassadorPageId: "Ambassador page ID",
} as const;

export const VOLUNTEER_PROD_DB_ID = env.notion.volunteerProdDbId() ?? "3ce3139dbfef809bbd60e1e4232e8238";
export const VOLUNTEER_DEV_DB_ID = env.notion.volunteerDevDbId() ?? "3ceb35e6e67f807d9fa4e219f3146462";

type Props = Record<string, unknown>;

/** Leading integer of a "5 — Excellent" label → 5 (em-dash tolerant); null otherwise. */
export function parseScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function title(props: Props, name: string): string | null {
  const p = props[name] as { title?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.title?.length) return null;
  return p.title.map((t) => t.plain_text ?? "").join("") || null;
}
function selectName(props: Props, name: string): string | null {
  const p = props[name] as { select?: { name?: string } | null } | undefined;
  return p?.select?.name ?? null;
}
function richText(props: Props, name: string): string | null {
  const p = props[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.rich_text?.length) return null;
  return p.rich_text.map((r) => r.plain_text ?? "").join("") || null;
}
function multiSelect(props: Props, name: string): string[] {
  const p = props[name] as { multi_select?: Array<{ name: string }> } | undefined;
  return (p?.multi_select ?? []).map((o) => o.name);
}

export interface VolunteerContent {
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
}

export function readVolunteerContent(props: Props): VolunteerContent {
  const preparednessLabel = selectName(props, VF.preparedness);
  const experienceLabel = selectName(props, VF.experience);
  return {
    volunteerName: title(props, VF.name),
    volunteerType: selectName(props, VF.type),
    city: selectName(props, VF.city),
    tracks: multiSelect(props, VF.tracks),
    preparednessLabel,
    preparednessScore: parseScore(preparednessLabel),
    experienceLabel,
    experienceScore: parseScore(experienceLabel),
    whatWorked: richText(props, VF.whatWorked),
    challenges: richText(props, VF.challenges),
    improvements: richText(props, VF.improvements),
  };
}

export interface VolunteerPage {
  id: string;
  createdTime: string;
  props: Props;
}

/** Fetch every page from the Ambassador prod volunteer-feedback DB (paginated). */
export async function fetchVolunteerFeedbackPages(): Promise<VolunteerPage[]> {
  const notion = getAmbassadorNotionClient();
  const out: VolunteerPage[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await notion.databases.query({
      database_id: VOLUNTEER_PROD_DB_ID,
      page_size: 100,
      start_cursor: cursor,
    } as never)) as any;
    for (const pg of res.results) out.push({ id: pg.id, createdTime: pg.created_time, props: pg.properties });
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

function rt(v: string | null) {
  return { rich_text: v ? [{ type: "text", text: { content: v.slice(0, 2000) } }] : [] };
}

/** Build the dev-mirror page write payload from parsed content + matched event. */
export function buildDevProperties(input: {
  content: VolunteerContent;
  submittedAtISO: string;
  eventName: string | null;
  eventDate: string | null;
  ambassadorPageId: string;
}): Props {
  const c = input.content;
  const props: Props = {
    [VF_DEV.name]: { title: c.volunteerName ? [{ type: "text", text: { content: c.volunteerName.slice(0, 2000) } }] : [] },
    [VF_DEV.tracks]: { multi_select: c.tracks.map((t) => ({ name: t })) },
    [VF_DEV.whatWorked]: rt(c.whatWorked),
    [VF_DEV.challenges]: rt(c.challenges),
    [VF_DEV.improvements]: rt(c.improvements),
    [VF_DEV.ambassadorPageId]: rt(input.ambassadorPageId),
    [VF_DEV.submitted]: { date: { start: input.submittedAtISO } },
  };
  if (c.volunteerType) props[VF_DEV.type] = { select: { name: c.volunteerType } };
  if (c.city) props[VF_DEV.city] = { select: { name: c.city } };
  if (c.preparednessLabel) props[VF_DEV.preparedness] = { select: { name: c.preparednessLabel } };
  if (c.preparednessScore != null) props[VF_DEV.preparednessScore] = { number: c.preparednessScore };
  if (c.experienceLabel) props[VF_DEV.experience] = { select: { name: c.experienceLabel } };
  if (c.experienceScore != null) props[VF_DEV.experienceScore] = { number: c.experienceScore };
  if (input.eventName) props[VF_DEV.event] = rt(input.eventName);
  if (input.eventDate) props[VF_DEV.eventDate] = { date: { start: input.eventDate } };
  return props;
}
