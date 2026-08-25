import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { listEvents } from "@/lib/db/events";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const events = await listEvents();
  let reconciled = 0;
  for (const ev of events) {
    // Re-running registration re-upserts guests (idempotent) and re-mirrors to Notion.
    await registerEventFromLuma(ev.luma_event_id);
    reconciled++;
  }
  return NextResponse.json({ reconciled });
}
export const GET = POST;
