import { describe, it, expect } from "vitest";
import { selectDeclinablePendings } from "../lib/events/decline-pending";
import type { GuestRow } from "../lib/db/guests";

const g = (status: GuestRow["luma_status"]): GuestRow => ({
  id: status, event_id: "e", luma_guest_id: status, name: null, email: null,
  luma_status: status, checked_in_at: null, answers: null, notion_page_id: null, last_synced_hash: null,
});

describe("selectDeclinablePendings", () => {
  it("selects only pending guests", () => {
    const out = selectDeclinablePendings([g("pending"), g("approved"), g("declined"), g("waitlist")]);
    expect(out.map((x) => x.luma_status)).toEqual(["pending"]);
  });
});
