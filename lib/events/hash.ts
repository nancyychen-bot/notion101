import { createHash } from "node:crypto";

/** Deterministic hash over the fields the hub mirrors (order-independent). */
export function syncedFieldsHash(fields: Record<string, unknown>): string {
  const norm = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ""}`)
    .join("|");
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** True if `incoming` matches the last hash we wrote (an echo of our own write). */
export function isEcho(incoming: Record<string, unknown>, lastHash: string | null): boolean {
  if (!lastHash) return false;
  return syncedFieldsHash(incoming) === lastHash;
}
