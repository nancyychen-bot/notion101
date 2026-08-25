import { NextResponse } from "next/server";
import { verifyFormToken } from "@/lib/auth/form-token";
import { env } from "@/lib/env";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { lumaLink, token } = (await req.json()) as { lumaLink?: string; token?: string };

  if (!token || !(await verifyFormToken(token, env.dashboard.sessionSecret(), Date.now()))) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  if (!lumaLink) {
    return NextResponse.json({ error: "missing link" }, { status: 400 });
  }

  try {
    const r = await registerEventFromLuma(lumaLink);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
