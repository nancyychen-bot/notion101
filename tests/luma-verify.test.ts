import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLumaSignature } from "../lib/luma/verify";

const SECRET = "whsec_test_secret";

function sign(rawBody: string, t: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyLumaSignature", () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: {} });
  const now = 1_800_000_000;

  it("accepts a valid signature", () => {
    const header = sign(rawBody, now);
    expect(verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = sign(rawBody, now);
    expect(
      verifyLumaSignature({ rawBody: rawBody + "x", signatureHeader: header, secret: SECRET, nowSec: now }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const header = sign(rawBody, now, "whsec_other");
    expect(verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now })).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", () => {
    const header = sign(rawBody, now - 10_000);
    expect(
      verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now, toleranceSec: 300 }),
    ).toBe(false);
  });

  it("rejects missing/garbage headers", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: null, secret: SECRET, nowSec: now })).toBe(false);
    expect(verifyLumaSignature({ rawBody, signatureHeader: "nonsense", secret: SECRET, nowSec: now })).toBe(false);
  });
});
