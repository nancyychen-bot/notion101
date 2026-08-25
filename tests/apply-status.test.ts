import { describe, it, expect, vi } from "vitest";
import { applyStatus } from "../lib/events/apply-status";
import type { GuestRow } from "../lib/db/guests";

const guest: GuestRow = {
  id: "g1", event_id: "e1", luma_guest_id: "gst-1", name: "Ada", email: "a@x.com",
  luma_status: "pending", checked_in_at: null, answers: null, notion_page_id: "pg1", last_synced_hash: null,
};

function deps() {
  return {
    setLumaStatus: vi.fn(async (_id: string, s: GuestRow["luma_status"]) => ({ ...guest, luma_status: s })),
    updateGuestOnLuma: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    pushToNotion: vi.fn(async () => {}),
    getEventLumaId: vi.fn(async () => "evt-1"),
    log: vi.fn(async () => {}),
  };
}

describe("applyStatus", () => {
  it("approve: writes Luma, sends approval email, mirrors to Notion", async () => {
    const d = deps();
    await applyStatus(guest, "approved", d);
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "approved");
    expect(d.sendEmail).toHaveBeenCalledWith("g1", "approved");
    expect(d.setLumaStatus).toHaveBeenCalledWith("g1", "approved");
    expect(d.pushToNotion).toHaveBeenCalled();
  });
  it("decline: sends decline email", async () => {
    const d = deps();
    await applyStatus(guest, "declined", d);
    expect(d.sendEmail).toHaveBeenCalledWith("g1", "decline");
  });
  it("no-op when status unchanged", async () => {
    const d = deps();
    await applyStatus({ ...guest, luma_status: "approved" }, "approved", d);
    expect(d.updateGuestOnLuma).not.toHaveBeenCalled();
  });
});
