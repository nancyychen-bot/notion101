/**
 * One-off cleanup: archive duplicate guest pages in the Notion guests DB that
 * share the same Luma Guest ID (created by the pre-fix webhook create-race).
 * Keeps the page Neon references (guests.notion_page_id), archives the rest.
 * Archiving = move to Notion trash (recoverable). Usage: npm run dedupe:guests
 */
import { getNotionClient } from "../lib/notion/client";
import { env } from "../lib/env";
import { sql } from "../lib/db/client";

const PROP_GUEST_ID = "Luma Guest ID";
const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

async function main() {
  const notion = getNotionClient();
  const dbId = env.notion.guestsDataSourceId();

  const guests = (await sql`select luma_guest_id, notion_page_id from guests where luma_guest_id is not null`) as {
    luma_guest_id: string; notion_page_id: string | null;
  }[];
  const canonical = new Map(guests.filter((g) => g.notion_page_id).map((g) => [g.luma_guest_id, norm(g.notion_page_id as string)]));

  const byGuestId = new Map<string, string[]>();
  let cursor: string | undefined;
  do {
    const res = (await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100 } as never)) as {
      results: { id: string; properties: Record<string, { rich_text?: { plain_text: string }[] }> }[];
      has_more: boolean; next_cursor: string | null;
    };
    for (const page of res.results) {
      const gid = (page.properties?.[PROP_GUEST_ID]?.rich_text ?? []).map((t) => t.plain_text).join("").trim();
      if (!gid) continue;
      (byGuestId.get(gid) ?? byGuestId.set(gid, []).get(gid)!).push(page.id);
    }
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);

  let groups = 0, archived = 0;
  for (const [gid, pageIds] of byGuestId) {
    if (pageIds.length <= 1) continue;
    groups++;
    const wanted = canonical.get(gid);
    const keep = pageIds.find((p) => wanted && norm(p) === wanted) ?? pageIds[0];
    for (const pid of pageIds) {
      if (pid === keep) continue;
      await notion.pages.update({ page_id: pid, archived: true } as never);
      archived++;
    }
    // eslint-disable-next-line no-console
    console.log(`${gid}: kept ${keep.slice(0, 8)}…, archived ${pageIds.length - 1}`);
  }
  // eslint-disable-next-line no-console
  console.log(`Done. ${groups} duplicated guests, ${archived} pages archived.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
