import { createHash } from "node:crypto";

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return String(value);
    }
    return value;
  }

  if (seen.has(value)) {
    throw new TypeError("Cannot canonicalize circular data");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return result;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, normalize(item, seen)] as const);

  seen.delete(value);
  return Object.fromEntries(entries);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
