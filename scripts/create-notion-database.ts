/**
 * Create the Notion 101 guest database and pin the Luma question→property map.
 *
 * Usage:
 *   npm run setup:notion -- --parent <notion-page-id> --luma <evt-id-or-url>
 *
 * Writes lib/notion/QUESTION_MAP.json (consumed by lib/notion/schema.ts).
 */
import { writeFileSync } from "node:fs";
import { Client } from "@notionhq/client";
import { env } from "../lib/env";
import { resolveLumaEventId, getLumaEvent, extractQuestionOptions } from "../lib/luma/client";
import { PROP } from "../lib/notion/schema";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parent = arg("--parent");
  const luma = arg("--luma");
  if (!parent || !luma) { console.error("Required: --parent <page-id> --luma <evt-id-or-url>"); process.exit(1); }

  const notion = new Client({ auth: env.notion.token() });
  const detail = await getLumaEvent(await resolveLumaEventId(luma));
  const questions = detail.registration_questions ?? [];

  // Heuristic label→property/kind wiring for the known Notion 101 form.
  const byLabel = (re: RegExp) => questions.find((q) => re.test(q.label ?? ""));
  const opt = (q: unknown) => (q ? extractQuestionOptions([q as never]).map((name) => ({ name })) : []);

  const qCompany = byLabel(/company do you own/i);
  const qSize = byLabel(/size of your company/i);
  const qTrack = byLabel(/track best fits/i);
  const qNotionEmail = byLabel(/email do you use for notion/i);
  const qPlan = byLabel(/type of notion plan/i);
  const qExp = byLabel(/experience level with notion/i);
  const qWhy = byLabel(/why do you want to come/i);
  const qNotes = byLabel(/anything you want us to know/i);

  const properties: Record<string, unknown> = {
    [PROP.name]: { title: {} },
    [PROP.email]: { email: {} },
    [PROP.status]: { select: { options: [
      { name: "Pending" }, { name: "Approved" }, { name: "Declined" }, { name: "Waitlist" },
    ] } },
    [PROP.checkedIn]: { date: {} },
    [PROP.event]: { rich_text: {} },
    [PROP.registeredAt]: { date: {} },
    [PROP.company]: { rich_text: {} },
    [PROP.jobTitle]: { rich_text: {} },
    [PROP.companySize]: { select: { options: opt(qSize) } },
    [PROP.businessTrack]: { select: { options: opt(qTrack) } },
    [PROP.notionAccountEmail]: { email: {} },
    [PROP.notionPlan]: { select: { options: opt(qPlan) } },
    [PROP.notionExperience]: { select: { options: opt(qExp) } },
    [PROP.whyAttending]: { multi_select: { options: opt(qWhy) } },
    [PROP.notes]: { rich_text: {} },
    [PROP.lumaGuestId]: { rich_text: {} },
    [PROP.lumaEventId]: { rich_text: {} },
  };

  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parent } as never,
    title: [{ type: "text", text: { content: "Notion 101 — Guests" } }] as never,
    properties: properties as never,
  });

  const map: Record<string, { prop: string; kind: string }> = {};
  const put = (q: { id?: string } | undefined, prop: string, kind: string) => {
    if (q?.id) map[q.id] = { prop, kind };
  };
  put(qCompany, PROP.company, "rich_text");
  put(qSize, PROP.companySize, "select");
  put(qTrack, PROP.businessTrack, "select");
  put(qNotionEmail, PROP.notionAccountEmail, "email");
  put(qPlan, PROP.notionPlan, "select");
  put(qExp, PROP.notionExperience, "select");
  put(qWhy, PROP.whyAttending, "multi_select");
  put(qNotes, PROP.notes, "rich_text");

  writeFileSync(new URL("../lib/notion/QUESTION_MAP.json", import.meta.url), JSON.stringify(map, null, 2));

  // eslint-disable-next-line no-console
  console.log("Created DB:", db.id);
  console.log("Set NOTION_GUESTS_DB_ID and its data source id in .env.local.");
  console.log("Wrote lib/notion/QUESTION_MAP.json:", map);
}
main().catch((e) => { console.error(e); process.exit(1); });
