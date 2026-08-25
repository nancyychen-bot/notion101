import { describe, it, expect } from "vitest";
import { syncedFieldsHash, isEcho } from "../lib/events/hash";

describe("echo hash", () => {
  it("same synced fields → same hash", () => {
    const a = syncedFieldsHash({ status: "approved", name: "Ada", email: "a@x.com" });
    const b = syncedFieldsHash({ email: "a@x.com", name: "Ada", status: "approved" });
    expect(a).toBe(b);
  });
  it("changed field → different hash, and isEcho reflects it", () => {
    const base = { status: "approved", name: "Ada", email: "a@x.com" };
    const h = syncedFieldsHash(base);
    expect(isEcho(base, h)).toBe(true);
    expect(isEcho({ ...base, status: "declined" }, h)).toBe(false);
  });
});
