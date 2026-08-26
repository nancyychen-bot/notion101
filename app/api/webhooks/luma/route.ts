import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { parseGuestWebhook } from "@/lib/luma/parse";
import { getEventByLumaId } from "@/lib/db/events";
import { upsertGuest } from "@/lib/db/guests";
import { pushGuestToNotion } from "@/lib/notion/push";
import { logSync } from "@/lib/db/sync-log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();

  // Verify HMAC if a secret is configured (Standard Webhooks / Svix scheme).
  const secret = env.luma.webhookSecret();
  if (secret) {
    const h = (n: string) => req.headers.get(n);
    const ok = verifyLumaSignature({
      rawBody: raw,
      signatureHeader: h("webhook-signature") ?? h("svix-signature") ?? h("Webhook-Signature"),
      webhookId: h("webhook-id") ?? h("svix-id"),
      timestamp: h("webhook-timestamp") ?? h("svix-timestamp"),
      secret,
    });
    if (!ok) {
      // TEMP DIAGNOSTIC: capture the exact signing headers so we can confirm Luma's
      // scheme. Remove once verified working.
      const dbg: Record<string, string> = {};
      req.headers.forEach((v, k) => { if (/webhook|svix|sign/i.test(k)) dbg[k] = v; });
      await logSync({ direction: "luma_in", result: "error", action: "verify", note: `bad signature | hdrs=${JSON.stringify(dbg)} | bodyLen=${raw.length}`.slice(0, 900) });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch {
    await logSync({ direction: "luma_in", result: "error", action: "received", note: `invalid json: ${raw.slice(0, 300)}` });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseGuestWebhook(body);
  if (!parsed) return NextResponse.json({ received: true, ignored: "no guest" });

  const event = await getEventByLumaId(parsed.lumaEventId);
  if (!event) {
    // Scoping gate — only registered Notion 101 events flow into the DB.
    await logSync({ direction: "luma_in", result: "skipped", action: "unregistered_event", note: parsed.lumaEventId });
    return NextResponse.json({ received: true, ignored: "unregistered event" });
  }

  const guest = await upsertGuest({
    eventId: event.id,
    lumaGuestId: parsed.lumaGuestId,
    name: parsed.name,
    email: parsed.email,
    lumaStatus: parsed.lumaStatus,
    checkedInAt: parsed.checkedInAt,
    answers: parsed.answers,
  });
  try {
    await pushGuestToNotion(guest, event);
    await logSync({ direction: "luma_in", result: "applied", guestId: guest.id, action: `guest_${parsed.type}` });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", guestId: guest.id, action: "notion_push", note: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json({ received: true });
}
