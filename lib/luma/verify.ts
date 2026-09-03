import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an inbound Luma webhook signature. Confirmed against live deliveries:
 *
 *   Header `webhook-signature: t=<unix>,v1=<hex>` (also sends `webhook-id` and
 *   `webhook-timestamp`, which we don't need). Signed payload is `{t}.{rawBody}`
 *   (the RAW body, pre-JSON.parse). HMAC-SHA256 keyed with the FULL `whsec_...`
 *   secret string, hex digest, constant-time compared against v1.
 */
export function verifyLumaSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  /** Reject signatures older than this many seconds (default 5 min); 0 disables. */
  toleranceSec?: number;
  /** Injectable clock for tests (unix seconds). */
  nowSec?: number;
}): boolean {
  const { rawBody, signatureHeader, secret } = params;
  if (!signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const { t, v1 } = parsed;

  const tolerance = params.toleranceSec ?? 300;
  if (tolerance > 0) {
    const now = params.nowSec ?? Math.floor(Date.now() / 1000);
    const ts = Number(t);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;
  }

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return safeEqualHex(expected, v1);
}

/**
 * Verify an inbound signature against a POOL of secrets (multi-calendar). Returns
 * true if any secret validates it. The matching secret identifies the sending
 * calendar, but callers route by the event id in the body, not by which matched.
 */
export function verifyAnyLumaSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secrets: string[];
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  const { rawBody, signatureHeader, secrets, toleranceSec, nowSec } = params;
  return secrets.some((secret) =>
    verifyLumaSignature({ rawBody, signatureHeader, secret, toleranceSec, nowSec }),
  );
}

function parseSignatureHeader(header: string): { t: string; v1: string } | null {
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(",").map((p) => p.trim())) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === "t") t = val;
    else if (key === "v1") v1 = val;
  }
  if (!t || !v1) return null;
  return { t, v1 };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
