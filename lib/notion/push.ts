import { getNotionClient } from "./client";
import { PROP, STATUS_TO_NOTION, QUESTION_MAP } from "./schema";
import { answersToProperties } from "./mappers";
import { syncedFieldsHash } from "../events/hash";
import { setNotionPageId, setSyncedHash, type GuestRow } from "../db/guests";
import { env } from "../env";

function richText(v: string) { return { rich_text: [{ text: { content: v } }] }; }
function title(v: string) { return { title: [{ text: { content: v } }] }; }

/** The fields we mirror to Notion — also the echo-hash input. */
function syncedFields(g: GuestRow) {
  return { name: g.name ?? "", email: g.email ?? "", status: g.luma_status };
}

/**
 * Create (or update) the Notion row for a guest and stamp the echo hash.
 * `eventName` labels the Event column. Best-effort answer mapping via QUESTION_MAP.
 */
export async function pushGuestToNotion(g: GuestRow, eventName: string | null): Promise<void> {
  const notion = getNotionClient();
  const answerProps = answersToProperties((g.answers as Record<string, string>) ?? {}, QUESTION_MAP);
  const props: Record<string, unknown> = {
    [PROP.name]: title(g.name ?? g.email ?? "Guest"),
    [PROP.status]: { select: { name: STATUS_TO_NOTION[g.luma_status] } },
    [PROP.event]: richText(eventName ?? ""),
    [PROP.lumaGuestId]: richText(g.luma_guest_id),
    [PROP.lumaEventId]: richText(g.event_id),
    ...(g.email ? { [PROP.email]: { email: g.email } } : {}),
    ...(g.checked_in_at ? { [PROP.checkedIn]: { date: { start: g.checked_in_at } } } : {}),
    ...answerProps,
  };

  if (g.notion_page_id) {
    await notion.pages.update({ page_id: g.notion_page_id, properties: props as never });
  } else {
    const created = await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: env.notion.guestsDataSourceId() } as never,
      properties: props as never,
    });
    await setNotionPageId(g.id, created.id);
  }
  await setSyncedHash(g.id, syncedFieldsHash(syncedFields(g)));
}
