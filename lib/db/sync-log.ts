import { sql } from "./client";

export interface SyncLogEntry {
  direction?: string;
  action?: string;
  result?: string;
  guestId?: string | null;
  note?: string | null;
  payload?: unknown;
}

/** Best-effort audit write — never throws (logging must not break a flow). */
export async function logSync(e: SyncLogEntry): Promise<void> {
  try {
    await sql`
      insert into sync_log (direction, action, result, guest_id, note, payload)
      values (${e.direction ?? null}, ${e.action ?? null}, ${e.result ?? null},
              ${e.guestId ?? null}, ${e.note ?? null},
              ${e.payload ? JSON.stringify(e.payload) : null})
    `;
  } catch {
    /* swallow — audit only */
  }
}
