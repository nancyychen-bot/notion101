import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { dispatchSurvey } from "@/lib/events/survey";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await dispatchSurvey());
}
export const GET = POST;
