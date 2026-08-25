import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/http/cron-auth";
import { dispatchDeclinePendingForTomorrow } from "@/lib/events/decline-pending";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await dispatchDeclinePendingForTomorrow();
  return NextResponse.json(result);
}
export const GET = POST;
