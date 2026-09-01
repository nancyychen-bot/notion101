import { getNotionClient } from "./client";
import { env } from "../env";

/** Property names pinned from the live shared "Build Bar Feedback" schema. */
export const FB = {
  name: "What is your name?",
  email: "What email do you use for Notion?",
  event: "Event", // select: "Build Bar" | "Notion 101"
  satisfaction: "How satisfied were you with this event?",
  confidence: "How confident are you using Notion after this event vs. before?",
  featureIntent: "Which feature or workflow will you try this week?",
  highlight: "What was the highlight, and anything we should improve?",
  interests: "Would you be interested in any of these?",
} as const;

/** Pinned ids (override via env if the DB is recreated). */
export const FEEDBACK_DB_ID = env.notion.feedbackDbId() ?? "d9ffd103ba354e35aeaf8e11101c2a42";
export const EVENT_TAG = "Notion 101"; // the Event select value we ingest

type Props = Record<string, unknown>;

/** Leading integer of a satisfaction select ("5 - Amazing" → 5); null otherwise. */
export function parseSatisfactionScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
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

export function readFeedbackEmail(props: Props): string | null {
  const p = props[FB.email] as { email?: string | null } | undefined;
  return p?.email ?? null;
}
export function readFeedbackName(props: Props): string | null {
  return richText(props, FB.name);
}

export interface FeedbackContent {
  satisfactionLabel: string | null;
  satisfactionScore: number | null;
  confidence: string | null;
  interests: string[];
  featureIntent: string | null;
  highlight: string | null;
}
export function readFeedbackContent(props: Props): FeedbackContent {
  const satisfactionLabel = selectName(props, FB.satisfaction);
  return {
    satisfactionLabel,
    satisfactionScore: parseSatisfactionScore(satisfactionLabel),
    confidence: selectName(props, FB.confidence),
    interests: multiSelect(props, FB.interests),
    featureIntent: richText(props, FB.featureIntent),
    highlight: richText(props, FB.highlight),
  };
}

export interface FeedbackPage {
  id: string;
  createdTime: string;
  props: Props;
}

/** Fetch every feedback page tagged Event="Notion 101" (paginated). */
export async function fetchNotion101FeedbackPages(): Promise<FeedbackPage[]> {
  const notion = getNotionClient();
  const out: FeedbackPage[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await notion.databases.query({
      database_id: FEEDBACK_DB_ID,
      page_size: 100,
      start_cursor: cursor,
      filter: { property: FB.event, select: { equals: EVENT_TAG } },
    } as never)) as any;
    for (const pg of res.results) {
      out.push({ id: pg.id, createdTime: pg.created_time, props: pg.properties });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}
