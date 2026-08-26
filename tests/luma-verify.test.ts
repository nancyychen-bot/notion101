import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLumaSignature } from "../lib/luma/verify";

// Standard Webhooks / Svix: key is base64-decoded bytes after `whsec_`.
const SECRET = "whsec_" + Buffer.from("a-32-byte-test-signing-key-value").toString("base64");

function sign(id: string, ts: number, rawBody: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
}

describe("verifyLumaSignature (Standard Webhooks / Svix)", () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: {} });
  const id = "msg_123";
  const now = 1_800_000_000;
  const base = { rawBody, webhookId: id, timestamp: String(now), secret: SECRET, nowSec: now };

  it("accepts a valid signature", () => {
    expect(verifyLumaSignature({ ...base, signatureHeader: sign(id, now, rawBody) })).toBe(true);
  });

  it("accepts when the header carries multiple space-separated signatures", () => {
    const header = `v1,aW52YWxpZA== ${sign(id, now, rawBody)}`;
    expect(verifyLumaSignature({ ...base, signatureHeader: header })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyLumaSignature({ ...base, rawBody: rawBody + "x", signatureHeader: sign(id, now, rawBody) })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const other = "whsec_" + Buffer.from("some-other-signing-key-bytes!!!!").toString("base64");
    expect(verifyLumaSignature({ ...base, signatureHeader: sign(id, now, rawBody, other) })).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", () => {
    expect(verifyLumaSignature({ ...base, signatureHeader: sign(id, now, rawBody), timestamp: String(now - 10_000), toleranceSec: 300 })).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyLumaSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifyLumaSignature({ ...base, signatureHeader: sign(id, now, rawBody), webhookId: null })).toBe(false);
    expect(verifyLumaSignature({ ...base, signatureHeader: sign(id, now, rawBody), timestamp: null })).toBe(false);
  });
});
