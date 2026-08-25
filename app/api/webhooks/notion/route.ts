import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getNotionClient } from "@/lib/notion/client";
import { readStatusFromPage } from "@/lib/notion/mappers";
import { isEcho } from "@/lib/events/hash";
import { getGuestByNotionPageId } from "@/lib/db/guests";
import { applyStatus, defaultApplyDeps } from "@/lib/events/apply-status";
import { logSync } from "@/lib/db/sync-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const SETTLE_MS = 3000; // let the button's property edit commit before we read

export async function POST(req: Request) {
  const raw = await req.text();
  let body: { page_id?: string; pageId?: string; id?: string; secret?: string; data?: { id?: string } } = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch {
    await logSync({ direction: "notion_in", result: "error", action: "received", note: `invalid json: ${raw.slice(0, 300)}` });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const secret = env.notion.webhookSecret();
  const provided = req.headers.get("x-webhook-secret") ?? body.secret;
  if (secret && provided !== secret) {
    await logSync({ direction: "notion_in", result: "error", action: "verify", note: "bad secret" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pageId = body.data?.id ?? body.page_id ?? body.pageId ?? body.id;
  if (!pageId) {
    await logSync({ direction: "notion_in", result: "error", action: "received", note: "no page id" });
    return NextResponse.json({ error: "missing page id" }, { status: 400 });
  }

  // `unstable_after` / `after` is not available in Next.js 14.2.x.
  // Await processNotion before returning (simple, correct; slightly slower ack).
  await processNotion(pageId);
  return NextResponse.json({ received: true });
}

async function processNotion(pageId: string): Promise<void> {
  try {
    const guest = await getGuestByNotionPageId(pageId);
    if (!guest) {
      await logSync({ direction: "notion_in", result: "error", action: "resolve", note: `no guest for page ${pageId}` });
      return;
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const notion = getNotionClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await notion.pages.retrieve({ page_id: pageId })) as any;

    const nextStatus = readStatusFromPage(page);
    if (!nextStatus) {
      await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: "noop_no_status" });
      return;
    }

    // Echo guard: drop if this matches our own last write.
    if (isEcho({ name: guest.name ?? "", email: guest.email ?? "", status: nextStatus }, guest.last_synced_hash)) {
      await logSync({ direction: "notion_in", result: "skipped", guestId: guest.id, action: "echo" });
      return;
    }
    if (nextStatus === guest.luma_status) {
      await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: "noop_unchanged" });
      return;
    }

    await applyStatus(guest, nextStatus, defaultApplyDeps("notion_in", guest.id));
    await logSync({ direction: "notion_in", result: "applied", guestId: guest.id, action: `status:${nextStatus}` });
  } catch (err) {
    await logSync({ direction: "notion_in", result: "error", action: "process", note: err instanceof Error ? err.message : String(err) });
  }
}
