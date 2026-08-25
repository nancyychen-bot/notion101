import { NOTION_TO_STATUS, type QuestionMap } from "./schema";

type PropValue = Record<string, unknown>;

/** Build Notion property values from raw Luma answers using the question map. */
export function answersToProperties(
  answers: Record<string, string>,
  qmap: QuestionMap,
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [qid, raw] of Object.entries(answers)) {
    const entry = qmap[qid];
    const value = (raw ?? "").trim();
    if (!entry || !value) continue;
    switch (entry.kind) {
      case "rich_text":
        out[entry.prop] = { rich_text: [{ text: { content: value } }] };
        break;
      case "email":
        out[entry.prop] = { email: value };
        break;
      case "select":
        out[entry.prop] = { select: { name: value } };
        break;
      case "multi_select":
        out[entry.prop] = {
          multi_select: value.split(",").map((s) => ({ name: s.trim() })).filter((o) => o.name),
        };
        break;
    }
  }
  return out;
}

/** Read the Status select from a retrieved page → hub status (lower-case) or null. */
export function readStatusFromPage(page: {
  properties?: Record<string, { type?: string; select?: { name?: string } | null }>;
}): "pending" | "approved" | "declined" | "waitlist" | null {
  const sel = page.properties?.Status;
  const name = sel?.select?.name;
  if (!name) return null;
  return NOTION_TO_STATUS[name] ?? null;
}
