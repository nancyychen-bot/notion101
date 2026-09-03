import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { connectCalendar, CalendarSlugTakenError } from "@/lib/events/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Standalone calendar onboarding (/add-calendar). Writes credentials, so it
 * requires the dashboard session. `/api/*` isn't in the middleware matcher, so
 * this route verifies the session itself. The key is validated against Luma
 * before the row is saved, so a bad key is never stored.
 */
export async function POST(req: Request) {
  if (!(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, env.dashboard.sessionSecret()))) {
    return NextResponse.json({ ok: false, error: "Unauthorized — log in to the dashboard first." }, { status: 401 });
  }

  const form = await req.formData();
  const slug = String(form.get("slug") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const webhookSecret = String(form.get("webhookSecret") ?? "").trim();
  const calendarUrl = String(form.get("calendarUrl") ?? "").trim();
  const city = String(form.get("city") ?? "").trim() || undefined;

  const missing = ([
    ["short id", slug],
    ["Luma API key", apiKey],
    ["webhook signing secret", webhookSecret],
    ["Luma calendar URL", calendarUrl],
  ] as const).find(([, v]) => !v);
  if (missing) {
    return NextResponse.json({ ok: false, error: `A ${missing[0]} is required.` }, { status: 400 });
  }
  if (!/[a-z0-9]/i.test(slug)) {
    return NextResponse.json({ ok: false, error: "The short id must contain letters or numbers (a–z, 0–9), e.g. korea." }, { status: 400 });
  }

  try {
    const result = await connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city });
    return NextResponse.json({ ok: true, calendar: { id: result.id, city: result.city } });
  } catch (err) {
    console.error("[add-calendar] connect failed", err);
    const raw = err instanceof Error ? err.message : "";
    const known = err instanceof CalendarSlugTakenError || /isn't valid|try again/.test(raw);
    const msg = known ? raw : "Couldn't connect that calendar. Check the API key and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
