import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an inbound Luma webhook signature using the "Standard Webhooks" (Svix)
 * scheme — the convention implied by the `whsec_...` secret.
 *
 * Headers (case-insensitive):
 *   webhook-id / svix-id
 *   webhook-timestamp / svix-timestamp   (unix seconds)
 *   webhook-signature / svix-signature   ("v1,<base64> v1,<base64> ...")
 *
 * Signed content is `${id}.${timestamp}.${rawBody}`. HMAC-SHA256 keyed with the
 * base64-decoded bytes of the secret AFTER the `whsec_` prefix, base64 digest,
 * constant-time compared against each `v1,` signature in the header.
 */
export function verifyLumaSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  webhookId?: string | null;
  timestamp?: string | null;
  secret: string;
  /** Reject signatures older than this many seconds (default 5 min); 0 disables. */
  toleranceSec?: number;
  /** Injectable clock for tests (unix seconds). */
  nowSec?: number;
}): boolean {
  const { rawBody, signatureHeader, webhookId, timestamp, secret } = params;
  if (!signatureHeader || !webhookId || !timestamp) return false;

  const tolerance = params.toleranceSec ?? 300;
  if (tolerance > 0) {
    const now = params.nowSec ?? Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;
  }

  // Key = base64-decoded bytes of the secret after the whsec_ prefix.
  const rawKey = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawKey, "base64");
    if (key.length === 0) return false;
  } catch {
    return false;
  }

  const expected = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest("base64");

  // Header is a space-separated list of `v1,<sig>` entries.
  for (const part of signatureHeader.split(" ")) {
    const comma = part.indexOf(",");
    if (comma === -1) continue;
    const sig = part.slice(comma + 1);
    if (sig && safeEqualB64(expected, sig)) return true;
  }
  return false;
}

function safeEqualB64(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "base64");
    const bb = Buffer.from(b, "base64");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
