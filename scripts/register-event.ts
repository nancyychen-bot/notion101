/**
 * Register a Notion 101 event and backfill its guests.
 * Usage: npm run register:event -- --luma <evt-id-or-url>
 */
import { registerEventFromLuma } from "../lib/events/register";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const luma = arg("--luma");
  if (!luma) { console.error("Required: --luma <evt-id-or-url>"); process.exit(1); }
  const r = await registerEventFromLuma(luma);
  // eslint-disable-next-line no-console
  console.log(`Registered ${r.eventName} (${r.lumaEventId}) — imported ${r.guestsImported} guests`);
}
main().catch((e) => { console.error(e); process.exit(1); });
