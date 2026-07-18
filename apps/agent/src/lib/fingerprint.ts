import { createHash } from "node:crypto";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

export function createFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
