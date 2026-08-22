import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization for digest-stable records.
 *
 * Keys are sorted recursively, arrays keep order, and only JSON scalar values
 * are accepted. This is the single serialization used for every RunParity
 * receipt, ledger, and signature digest, so any shape change is a digest
 * change and invalidates prior receipts by construction.
 */
export function canonicalJsonString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonString(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonString(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("RP_CANONICAL_JSON_REJECTED_NON_JSON_VALUE");
  }
  return serialized;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalSha256Hex(value: unknown): string {
  return sha256Hex(canonicalJsonString(value));
}

const HEX_64 = /^[a-f0-9]{64}$/u;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && HEX_64.test(value);
}
