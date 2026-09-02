import {
  fetchVolunteerFeedbackPages, readVolunteerContent, buildDevProperties, VOLUNTEER_DEV_DB_ID,
} from "../notion/volunteer-feedback";
import { getNotionClient } from "../notion/client";
import { selectEventForFeedback } from "./feedback-match";
import {
  upsertVolunteerFeedback, getDevPageId, eventsInCity,
} from "../db/volunteer-feedback";
import { getEventById } from "../db/events";
import { logSync } from "../db/sync-log";

export interface VolunteerImportResult {
  imported: number;
  matched: number;
  unattributed: number;
}

/**
 * Mirror Ambassador-prod volunteer feedback into the dev DB + Neon. Idempotent by
 * ambassador page id (Neon-primary dev_page_id map). Attribution: City+date — the
 * most recent Notion 101 event in that city on/before the Submitted date.
 */
export async function importVolunteerFeedback(): Promise<VolunteerImportResult> {
  const dev = getNotionClient();
  const pages = await fetchVolunteerFeedbackPages();
  let imported = 0, matched = 0, unattributed = 0;

  for (const pg of pages) {
    const content = readVolunteerContent(pg.props);

    // City + date attribution.
    let eventId: string | null = null;
    let eventName: string | null = null;
    let eventDate: string | null = null;
    if (content.city) {
      const chosen = selectEventForFeedback(await eventsInCity(content.city), pg.createdTime);
      if (chosen) {
        eventId = chosen.eventId;
        const ev = await getEventById(chosen.eventId);
        eventName = ev?.name ?? null;
        eventDate = ev?.start_at ?? null;
      }
    }
    if (eventId) matched++; else unattributed++;

    // Write/refresh the dev mirror page (Neon-tracked idempotency).
    const props = buildDevProperties({
      content, submittedAtISO: pg.createdTime, eventName, eventDate, ambassadorPageId: pg.id,
    });
    let devPageId = await getDevPageId(pg.id);
    if (devPageId) {
      try {
        await dev.pages.update({ page_id: devPageId, properties: props as never });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not[ _]?found|could not find|archived/i.test(msg)) throw err;
        devPageId = null; // recreate below
      }
    }
    if (!devPageId) {
      const created = (await dev.pages.create({
        parent: { database_id: VOLUNTEER_DEV_DB_ID } as never,
        properties: props as never,
      })) as { id: string };
      devPageId = created.id;
    }

    await upsertVolunteerFeedback({
      ambassadorPageId: pg.id,
      devPageId,
      eventId,
      volunteerName: content.volunteerName,
      volunteerType: content.volunteerType,
      city: content.city,
      tracks: content.tracks,
      preparednessLabel: content.preparednessLabel,
      preparednessScore: content.preparednessScore,
      experienceLabel: content.experienceLabel,
      experienceScore: content.experienceScore,
      whatWorked: content.whatWorked,
      challenges: content.challenges,
      improvements: content.improvements,
      submittedAt: pg.createdTime,
    });
    imported++;
  }

  await logSync({
    direction: "cron", result: "applied", action: "volunteer_feedback_import",
    note: `imported=${imported} matched=${matched} unattributed=${unattributed}`,
  });
  return { imported, matched, unattributed };
}
