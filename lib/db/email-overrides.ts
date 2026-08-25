import { sql } from "./client";
import type { OverrideMap } from "../email/templates";

export interface OverrideRow {
  key: string;
  draft_subject: string | null;
  draft_body: string | null;
  draft_note: string | null;
  draft_updated_at: string | null;
  live_subject: string | null;
  live_body: string | null;
  live_updated_at: string | null;
}

/** All override rows (draft + live) for the editor. */
export async function listOverrides(): Promise<OverrideRow[]> {
  return (await sql`select * from email_overrides`) as OverrideRow[];
}

/** Map of kind → published subject/body, only where a live override exists. */
export async function getLiveOverrideMap(): Promise<OverrideMap> {
  const rows = (await sql`select key, live_subject, live_body from email_overrides`) as {
    key: string; live_subject: string | null; live_body: string | null;
  }[];
  const map: OverrideMap = new Map();
  for (const r of rows) {
    if (r.live_subject != null || r.live_body != null) {
      map.set(r.key, { subject: r.live_subject, body: r.live_body });
    }
  }
  return map;
}

/** Upsert a draft. */
export async function saveDraft(key: string, subject: string, body: string, note: string | null): Promise<void> {
  await sql`
    insert into email_overrides (key, draft_subject, draft_body, draft_note, draft_updated_at)
    values (${key}, ${subject}, ${body}, ${note}, now())
    on conflict (key) do update set
      draft_subject = excluded.draft_subject,
      draft_body = excluded.draft_body,
      draft_note = excluded.draft_note,
      draft_updated_at = now()
  `;
}

/** Copy draft → live, then clear the draft. No-op if there is no draft. */
export async function publishDraft(key: string): Promise<void> {
  await sql`
    update email_overrides set
      live_subject = draft_subject,
      live_body = draft_body,
      live_updated_at = now(),
      draft_subject = null, draft_body = null, draft_note = null, draft_updated_at = null
    where key = ${key} and (draft_subject is not null or draft_body is not null)
  `;
}

/** Clear the draft (leaves live untouched). */
export async function discardDraft(key: string): Promise<void> {
  await sql`
    update email_overrides set
      draft_subject = null, draft_body = null, draft_note = null, draft_updated_at = null
    where key = ${key}
  `;
}
