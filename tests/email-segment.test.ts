import { describe, it, expect } from "vitest";
import { planSegment } from "../lib/email/segment";

const QMAP = { ialukd7h: { prop: "Notion Plan", kind: "select" } };

describe("planSegment", () => {
  it("treats Free and No Account as free", () => {
    expect(planSegment({ ialukd7h: "Free" }, QMAP)).toBe("free");
    expect(planSegment({ ialukd7h: "No Account" }, QMAP)).toBe("free");
  });
  it("treats Plus/Business/Enterprise as paid", () => {
    expect(planSegment({ ialukd7h: "Plus" }, QMAP)).toBe("paid");
    expect(planSegment({ ialukd7h: "Business" }, QMAP)).toBe("paid");
    expect(planSegment({ ialukd7h: "Enterprise" }, QMAP)).toBe("paid");
  });
  it("treats blank/unknown/missing as free", () => {
    expect(planSegment({ ialukd7h: "" }, QMAP)).toBe("free");
    expect(planSegment({}, QMAP)).toBe("free");
    expect(planSegment(null, QMAP)).toBe("free");
  });
});
