import { getNotionClient } from "./client";
import { PROP, STATUS_TO_NOTION, QUESTION_MAP } from "./schema";
import { answersToProperties } from "./mappers";
import { syncedFieldsHash } from "../events/hash";
import { setNotionPageId, setSyncedHash, type GuestRow } from "../db/guests";
import type { EventRow } from "../db/events";
import { env } from "../env";

function richText(v: string) { return { rich_text: [{ text: { content: v } }] }; }
function title(v: string) { return { title: [{ text: { content: v } }] }; }

/** The fields we mirror to Notion — also the echo-hash input. */
function syncedFields(g: GuestRow) {
  return { name: g.name ?? "", email: g.email ?? "", status: g.luma_status };
}

/**
 * Create (or update) the Notion row for a guest and stamp the echo hash.
 * `event` supplies the Event name/id, plus Event Date (start) and Location,
 * all captured at ingestion. Best-effort answer mapping via QUESTION_MAP.
 */
export async function pushGuestToNotion(
  g: GuestRow,
  event: EventRow | null,
): Promise<void> {
  const notion = getNotionClient();
  const answerProps = answersToProperties((g.answers as Record<string, string>) ?? {}, QUESTION_MAP);
  const props: Record<string, unknown> = {
    [PROP.name]: title(g.name ?? g.email ?? "Guest"),
    [PROP.status]: { select: { name: STATUS_TO_NOTION[g.luma_status] } },
    [PROP.event]: richText(event?.name ?? ""),
    [PROP.lumaGuestId]: richText(g.luma_guest_id),
    [PROP.lumaEventId]: richText(event?.luma_event_id ?? ""),
    ...(g.email ? { [PROP.email]: { email: g.email } } : {}),
    ...(g.checked_in_at ? { [PROP.checkedIn]: { date: { start: g.checked_in_at } } } : {}),
    ...(event?.start_at ? { [PROP.eventDate]: { date: { start: event.start_at } } } : {}),
    ...(event?.location ? { [PROP.location]: { select: { name: event.location } } } : {}),
    ...answerProps,
  };

  if (g.notion_page_id) {
    await notion.pages.update({ page_id: g.notion_page_id, properties: props as never });
  } else {
    // The installed @notionhq/client defaults to the 2022-06-28 API (no data
    // sources — a database IS its own data source), so we parent by database_id.
    const created = await notion.pages.create({
      parent: { database_id: env.notion.guestsDataSourceId() } as never,
      properties: props as never,
    });
    await setNotionPageId(g.id, created.id);
  }
  await setSyncedHash(g.id, syncedFieldsHash(syncedFields(g)));
}
