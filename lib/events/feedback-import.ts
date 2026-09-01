import {
  fetchNotion101FeedbackPages,
  readFeedbackContent,
  readFeedbackEmail,
  readFeedbackName,
} from "../notion/feedback";
import { candidatesByEmail, candidatesByName, upsertFeedback } from "../db/feedback";
import { selectEventForFeedback } from "./feedback-match";
import { logSync } from "../db/sync-log";

export interface ImportResult {
  imported: number;
  matched: number;
  unattributed: number;
}

/**
 * Pull every Event="Notion 101" feedback row, match each to a local guest/event,
 * and upsert into the feedback table. Idempotent by notion_page_id. Feedback can
 * arrive days/weeks after the event, so matching is by identity (email, then
 * name), NOT a time window — email→guest→event is authoritative for a series.
 * Unmatched rows are stored with null event and counted.
 */
export async function importFeedback(): Promise<ImportResult> {
  const pages = await fetchNotion101FeedbackPages();
  let imported = 0;
  let matched = 0;
  let unattributed = 0;

  for (const pg of pages) {
    const email = readFeedbackEmail(pg.props);
    const name = readFeedbackName(pg.props);
    const content = readFeedbackContent(pg.props);

    // Email first (authoritative); fall back to name against the RSVP list.
    let candidates = email ? await candidatesByEmail(email) : [];
    if (candidates.length === 0 && name) candidates = await candidatesByName(name);
    const chosen = selectEventForFeedback(candidates, pg.createdTime);
    const eventId = chosen?.eventId ?? null;
    const guestId = chosen?.guestId ?? null;
    if (eventId) matched++;
    else unattributed++;

    await upsertFeedback({
      notionPageId: pg.id,
      eventId,
      guestId,
      respondentName: name,
      respondentEmail: email,
      satisfactionScore: content.satisfactionScore,
      satisfactionLabel: content.satisfactionLabel,
      confidence: content.confidence,
      interests: content.interests,
      featureIntent: content.featureIntent,
      highlight: content.highlight,
      submittedAt: pg.createdTime,
    });
    imported++;
  }

  await logSync({
    direction: "cron",
    result: "applied",
    action: "feedback_import",
    note: `imported=${imported} matched=${matched} unattributed=${unattributed}`,
  });
  return { imported, matched, unattributed };
}
