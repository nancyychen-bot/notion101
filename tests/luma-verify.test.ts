import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLumaSignature, verifyAnyLumaSignature } from "../lib/luma/verify";

// Confirmed live: HMAC-SHA256 over `${t}.${body}`, keyed with the FULL whsec_ string, hex.
const SECRET = "whsec_test_secret";

function sign(rawBody: string, t: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyLumaSignature", () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: {} });
  const now = 1_800_000_000;

  it("accepts a valid signature", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: sign(rawBody, now), secret: SECRET, nowSec: now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyLumaSignature({ rawBody: rawBody + "x", signatureHeader: sign(rawBody, now), secret: SECRET, nowSec: now })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: sign(rawBody, now, "whsec_other"), secret: SECRET, nowSec: now })).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: sign(rawBody, now - 10_000), secret: SECRET, nowSec: now, toleranceSec: 300 })).toBe(false);
  });

  it("rejects missing/garbage headers", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: null, secret: SECRET, nowSec: now })).toBe(false);
    expect(verifyLumaSignature({ rawBody, signatureHeader: "nonsense", secret: SECRET, nowSec: now })).toBe(false);
  });
});

function signPool(secret: string, body: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyAnyLumaSignature", () => {
  const body = '{"hello":"world"}';
  const now = 1_700_000_000;

  it("accepts a signature made with any secret in the pool", () => {
    const header = signPool("whsec-korea", body, now);
    expect(
      verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: ["whsec-default", "whsec-korea"], nowSec: now }),
    ).toBe(true);
  });

  it("rejects when no secret matches", () => {
    const header = signPool("whsec-unknown", body, now);
    expect(
      verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: ["whsec-default", "whsec-korea"], nowSec: now }),
    ).toBe(false);
  });

  it("rejects an empty pool", () => {
    const header = signPool("whsec-default", body, now);
    expect(verifyAnyLumaSignature({ rawBody: body, signatureHeader: header, secrets: [], nowSec: now })).toBe(false);
  });
});
