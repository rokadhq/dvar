import { getPath } from "./object-path.js";
import type { DvarMatchValue, DvarMatcher } from "./types.js";

function isMatcher(value: DvarMatchValue): value is DvarMatcher {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  const keys = Object.keys(value);
  const matcherKeys = new Set([
    "equals",
    "notEquals",
    "in",
    "notIn",
    "containsAny",
    "containsAll",
    "exists",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "prefix",
    "suffix",
    "matches",
    "equalsContext"
  ]);
  return keys.length > 0 && keys.every((key) => matcherKeys.has(key));
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => same(item, right[index]));
  }
  return false;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeRegex(pattern: string): RegExp | undefined {
  if (pattern.length > 256) return undefined;
  if (/\\\d/.test(pattern) || /\(\?<?[=!]/.test(pattern)) return undefined;
  if (/([+*}]\s*){2,}/.test(pattern)) return undefined;
  try {
    return new RegExp(pattern, "u");
  } catch {
    return undefined;
  }
}

export function matchesValue(
  actual: unknown,
  expected: DvarMatchValue,
  context: unknown
): boolean {
  if (!isMatcher(expected)) {
    if (Array.isArray(expected)) return expected.some((item) => same(actual, item));
    return same(actual, expected);
  }

  if (expected.exists !== undefined) {
    const exists = actual !== undefined && actual !== null;
    if (exists !== expected.exists) return false;
  }
  if ("equals" in expected && !same(actual, expected.equals)) return false;
  if ("notEquals" in expected && same(actual, expected.notEquals)) return false;
  if (expected.in !== undefined && !expected.in.some((item) => same(actual, item))) return false;
  if (expected.notIn !== undefined && expected.notIn.some((item) => same(actual, item))) return false;
  if (expected.containsAny !== undefined) {
    const values = asArray(actual);
    if (!expected.containsAny.some((item) => values.some((value) => same(value, item)))) return false;
  }
  if (expected.containsAll !== undefined) {
    const values = asArray(actual);
    if (!expected.containsAll.every((item) => values.some((value) => same(value, item)))) return false;
  }
  if (expected.greaterThan !== undefined && !(typeof actual === "number" && actual > expected.greaterThan)) return false;
  if (expected.greaterThanOrEqual !== undefined && !(typeof actual === "number" && actual >= expected.greaterThanOrEqual)) return false;
  if (expected.lessThan !== undefined && !(typeof actual === "number" && actual < expected.lessThan)) return false;
  if (expected.lessThanOrEqual !== undefined && !(typeof actual === "number" && actual <= expected.lessThanOrEqual)) return false;
  if (expected.prefix !== undefined && !(typeof actual === "string" && actual.startsWith(expected.prefix))) return false;
  if (expected.suffix !== undefined && !(typeof actual === "string" && actual.endsWith(expected.suffix))) return false;
  if (expected.matches !== undefined) {
    const regex = safeRegex(expected.matches);
    if (regex === undefined || typeof actual !== "string" || !regex.test(actual)) return false;
  }
  if (expected.equalsContext !== undefined && !same(actual, getPath(context, expected.equalsContext))) return false;

  return true;
}

export function matchesRecord(
  record: Record<string, DvarMatchValue> | undefined,
  action: unknown
): boolean {
  if (record === undefined) return true;
  return Object.entries(record).every(([path, expected]) =>
    matchesValue(getPath(action, path), expected, action)
  );
}
