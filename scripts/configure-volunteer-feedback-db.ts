/**
 * Run once: build the dev "Volunteer Feedback Notion 101s" DB properties to match
 * the mirror writer (VF_DEV names). Uses databases.update (classic-shape DB).
 * Usage: npm run setup:volunteer-feedback
 */
import { Client } from "@notionhq/client";

const DB_ID = process.env.NOTION_VOLUNTEER_DEV_DB_ID ?? "3ceb35e6e67f807d9fa4e219f3146462";

const PREP = ["5 — Very prepared", "4 — Prepared", "3 — Somewhat prepared", "2 — Underprepared", "1 — Not prepared"];
const EXP = ["5 — Excellent", "4 — Good", "3 — Okay", "2 — Difficult", "1 — Poor"];
const TRACKS = ["Brick & Mortar", "E-commerce & Online", "Services", "Combined / General"];
const TYPES = ["Ambassador", "Notino", "Event partner", "Other volunteer"];
const CITIES = ["New York", "San Francisco"];
const opts = (names: string[]) => ({ options: names.map((name) => ({ name })) });

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const notion = new Client({ auth: token });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await notion.databases.retrieve({ database_id: DB_ID })) as any;
  const titleName = Object.entries(db.properties).find(([, v]: [string, any]) => v?.type === "title")?.[0] ?? "Name";

  const properties: Record<string, unknown> = {
    [titleName]: { name: "Volunteer name" }, // rename existing title
    "Volunteer type": { select: opts(TYPES) },
    "City": { select: opts(CITIES) },
    "Track(s) supported": { multi_select: opts(TRACKS) },
    "Preparedness": { select: opts(PREP) },
    "Preparedness score": { number: {} },
    "Overall experience": { select: opts(EXP) },
    "Experience score": { number: {} },
    "What worked well": { rich_text: {} },
    "Challenges": { rich_text: {} },
    "Improvements": { rich_text: {} },
    "Submitted": { date: {} },
    "Event": { rich_text: {} },
    "Event Date": { date: {} },
    "Ambassador page ID": { rich_text: {} },
  };

  await notion.databases.update({ database_id: DB_ID, properties: properties as never });
  // eslint-disable-next-line no-console
  console.log("Volunteer Feedback dev DB configured:", DB_ID);
}
main().catch((e) => { console.error(e); process.exit(1); });
