import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { importVolunteerFeedback } from "@/lib/events/volunteer-feedback-import";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const sessionToken = cookies().get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(sessionToken, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await importVolunteerFeedback());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "import failed" }, { status: 500 });
  }
}
