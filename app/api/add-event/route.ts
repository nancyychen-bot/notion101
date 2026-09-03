import { NextResponse } from "next/server";
import { verifyFormToken } from "@/lib/auth/form-token";
import { env } from "@/lib/env";
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { resolveNewCalendarEvent, resolveCalendarSlug, CalendarSlugTakenError } from "@/lib/events/onboard";
import { upsertLumaCalendar } from "@/lib/db/luma-calendars";
import { __bustCalendarCache } from "@/lib/luma/calendars";
import { LumaUrlUnresolvedError, LumaApiKeyInvalidError } from "@/lib/luma/client";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  lumaLink?: string;
  token?: string;
  calendarApiKey?: string;
  calendarWebhookSecret?: string;
  calendarUrl?: string;
  calendarSlug?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { lumaLink, token } = body;

  if (!token || !(await verifyFormToken(token, env.dashboard.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  }
  if (!lumaLink) {
    return NextResponse.json({ ok: false, error: "missing link" }, { status: 400 });
  }

  const calendarApiKey = body.calendarApiKey?.trim() || undefined;
  const calendarWebhookSecret = body.calendarWebhookSecret?.trim() || undefined;
  const calendarUrl = body.calendarUrl?.trim() || undefined;
  const calendarSlug = body.calendarSlug?.trim() || undefined;

  try {
    // New-calendar path: a key was pasted for an unconnected calendar. Public,
    // self-service (form-token only, no login) so the link works for everyone —
    // including inside the Notion iframe where a session cookie isn't sent. The
    // key is validated against the event before it's stored.
    if (calendarApiKey) {
      if (!calendarUrl) {
        return NextResponse.json({ ok: false, error: "A Luma calendar URL is required to connect a new calendar." }, { status: 400 });
      }
      if (!calendarWebhookSecret) {
        return NextResponse.json({ ok: false, error: "A webhook signing secret is required to connect a new calendar (enables live guest sync)." }, { status: 400 });
      }
      const resolved = await resolveNewCalendarEvent({ lumaEvent: lumaLink, apiKey: calendarApiKey });
      const id = await resolveCalendarSlug(calendarSlug ?? "", resolved.city, resolved.calendarId);
      await upsertLumaCalendar({
        id,
        apiKey: calendarApiKey,
        webhookSecret: calendarWebhookSecret,
        calendarId: resolved.calendarId,
        city: resolved.city,
        calendarUrl,
      });
      __bustCalendarCache();
    }

    const r = await registerEventFromLuma(lumaLink);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if ((err instanceof CalendarNotConnectedError || err instanceof LumaUrlUnresolvedError) && !calendarApiKey) {
      // Not an error — prompt to connect this calendar (reveals the fields).
      return NextResponse.json({
        ok: false,
        needsCalendar: true,
        error: "This event's Luma calendar isn't connected yet. Paste its Luma API key below to connect it (one-time), then add the event.",
      });
    }
    if (err instanceof CalendarSlugTakenError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: err.message }, { status: 400 });
    }
    if (err instanceof LumaApiKeyInvalidError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: "That Luma API key isn't valid — copy it from the calendar's Settings → Options → Luma API." }, { status: 400 });
    }
    const raw = err instanceof Error ? err.message : "";
    let msg = "Couldn't add that event — check the Luma event URL and try again.";
    if (/can't see this event/i.test(raw)) msg = raw;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
