import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { importFeedback } from "@/lib/events/feedback-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await importFeedback();
  return NextResponse.json(r);
}
export const GET = POST;
