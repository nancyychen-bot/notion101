import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { listEvents } from "@/lib/db/events";
import { registerEventFromLuma } from "@/lib/events/register";
import { logSync } from "@/lib/db/sync-log";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const events = await listEvents();
  let reconciled = 0;
  const failures: { event: string; error: string }[] = [];
  for (const ev of events) {
    // Re-running registration re-upserts guests (idempotent) and re-mirrors to
    // Notion. Isolate each event: a single failure (event deleted on Luma, a
    // revoked calendar key, etc.) must not abort the rest of the reconcile.
    try {
      await registerEventFromLuma(ev.luma_event_id);
      reconciled++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ event: ev.luma_event_id, error: msg });
      await logSync({
        direction: "cron",
        result: "error",
        action: "reconcile",
        note: `${ev.luma_event_id}: ${msg}`.slice(0, 200),
      });
    }
  }
  return NextResponse.json({ reconciled, failed: failures.length, failures });
}
export const GET = POST;
