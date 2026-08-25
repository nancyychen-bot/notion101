import { NextResponse } from "next/server";
import { registerEventFromLuma } from "@/lib/events/register";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  // Guard: only an authenticated dashboard session may trigger a sync.
  // Request (Web API) does not expose .cookies — parse the Cookie header directly.
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const sessionToken = match?.[1];
  if (!(await isValidSession(sessionToken, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { lumaEventId } = (await req.json()) as { lumaEventId?: string };
  if (!lumaEventId) return NextResponse.json({ error: "missing lumaEventId" }, { status: 400 });
  const r = await registerEventFromLuma(lumaEventId);
  return NextResponse.json(r);
}
