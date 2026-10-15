import { DvarAuthorityError, fail, type DvarAuthorityReason } from "./errors.js";

export function record(value: unknown, allowed: readonly string[], code: DvarAuthorityReason): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) fail(code);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.includes(key)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    }
    return value as Record<string, unknown>;
  } catch { return fail(code); }
}

export function text(value: unknown, code: DvarAuthorityReason, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

export function number(value: unknown, code: DvarAuthorityReason, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

export function strings(value: unknown, code: DvarAuthorityReason, min = 0, max = 32): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(code);
  const result = value.map(item => text(item, code));
  if (new Set(result).size !== result.length) fail(code);
  return result.sort();
}

/** Snapshot only bounded JSON data. Reject getters, toJSON/classes, symbols, cycles and sparse arrays. */
export function snapshot<T>(value: T, code: DvarAuthorityReason, maxBytes = 65_536): T {
  let nodes = 0;
  let bytes = 0;
  const seen = new WeakSet<object>();
  function charge(value: string): void {
    if (value.length > maxBytes) fail(code);
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > maxBytes) fail(code);
  }
  function visit(input: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 32) fail(code);
    if (typeof input === "string") { charge(input); return input; }
    if (input === null || typeof input === "boolean") { bytes += 5; return input; }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) fail(code);
      bytes += String(input).length;
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input !== "object") fail(code);
    if (seen.has(input)) fail(code);
    seen.add(input);
    let output: unknown;
    if (Array.isArray(input)) {
      if (input.length > 4096 || Reflect.ownKeys(input).length !== input.length + 1) fail(code);
      const array: unknown[] = [];
      for (let i = 0; i < input.length; i += 1) {
        const prop = Object.getOwnPropertyDescriptor(input, String(i));
        if (!prop?.enumerable || !("value" in prop)) fail(code);
        array.push(visit(prop.value, depth + 1));
      }
      bytes += input.length + 2;
      output = Object.freeze(array);
    } else {
      const proto: unknown = Object.getPrototypeOf(input);
      if (proto !== null && proto !== Object.prototype) fail(code);
      const keys = Reflect.ownKeys(input);
      if (keys.length > 4096 || keys.some(key => typeof key !== "string")) fail(code);
      const result: Record<string, unknown> = {};
      for (const key of (keys as string[]).sort()) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail(code);
        const prop = Object.getOwnPropertyDescriptor(input, key);
        if (!prop?.enumerable || !("value" in prop)) fail(code);
        charge(key);
        result[key] = visit(prop.value, depth + 1);
      }
      bytes += keys.length * 2 + 2;
      output = Object.freeze(result);
    }
    seen.delete(input);
    if (bytes > maxBytes) fail(code);
    return output;
  }
  try {
    const result = visit(value, 0) as T;
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) fail(code);
    return result;
  } catch (error) {
    // Proxy traps and malformed host objects must not expose their exception payloads.
    if (error instanceof DvarAuthorityError && error.code === code) throw error;
    return fail(code);
  }
}

export function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
