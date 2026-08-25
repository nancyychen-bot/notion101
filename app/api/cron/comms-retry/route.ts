import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { listFailed } from "@/lib/db/email-log";
import { sendGuestEmail } from "@/lib/email/comms";
import type { EmailKind } from "@/lib/email/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const failed = await listFailed();
  for (const row of failed) await sendGuestEmail(row.guest_id, row.kind as EmailKind);
  return NextResponse.json({ retried: failed.length });
}
export const GET = POST;
