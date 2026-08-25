import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { registerEventFromLuma } from "@/lib/events/register";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  // Guard: only an authenticated dashboard session may trigger a sync.
  const sessionToken = cookies().get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(sessionToken, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let lumaEventId: string | undefined;
  try {
    ({ lumaEventId } = (await req.json()) as { lumaEventId?: string });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!lumaEventId) return NextResponse.json({ error: "missing lumaEventId" }, { status: 400 });
  try {
    const r = await registerEventFromLuma(lumaEventId);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "sync failed" }, { status: 500 });
  }
}
