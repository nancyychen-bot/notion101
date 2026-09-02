import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { importVolunteerFeedback } from "@/lib/events/volunteer-feedback-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await importVolunteerFeedback();
  return NextResponse.json(r);
}
export const GET = POST;
