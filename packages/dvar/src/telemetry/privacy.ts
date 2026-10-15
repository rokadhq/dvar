import type { DvarOtelAttributes, DvarOtelSpanContext, DvarTelemetryEvent } from "./types.js";

export const DVAR_TELEMETRY_SCHEMA_VERSION = "1";
export const DVAR_GENAI_SEMCONV_VERSION = "1.37.0";
export const DVAR_GENAI_SCHEMA_URL = "https://opentelemetry.io/schemas/1.37.0";

export function enumValue(value: unknown, values: readonly string[], fallback = "unknown"): string {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
export function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  // Do not invoke getters on arbitrary tool results/errors.
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
export function modeValue(value: unknown): string {
  return enumValue(value, ["off", "monitor", "enforce", "strict"]);
}
export function reasonFamily(value: unknown): string {
  if (typeof value !== "string" || value.length > 128) return "other";
  return enumValue(value.split(".", 1)[0],
    ["policy", "rule", "default", "identity", "argument", "tool", "approval", "runtime", "quota", "output", "network"], "other");
}
export function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function aliases(value: Readonly<Record<string, string>> | undefined): Map<string, string> {
  const entries = Object.entries(value ?? {});
  if (entries.length > 128 || entries.some(([key, alias]) =>
    key.length === 0 || key.length > 256 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(alias))) {
    throw new TypeError("Telemetry aliases need at most 128 bounded public names.");
  }
  return new Map(entries);
}
export function parseTraceparent(value: string): DvarOtelSpanContext | undefined {
  // Version 00 MUST be exactly 55 lowercase ASCII characters; zero ids are invalid.
  if (typeof value !== "string" || value.length !== 55) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u.exec(value);
  if (match === null || !match[1] || !match[2] || !match[3] ||
    /^0+$/u.test(match[1]) || /^0+$/u.test(match[2])) return undefined;
  return { traceId: match[1], spanId: match[2], traceFlags: parseInt(match[3], 16) & 1, isRemote: true };
}
export function validSpanContext(value: DvarOtelSpanContext): boolean {
  return /^[0-9a-f]{32}$/u.test(value.traceId) && !/^0+$/u.test(value.traceId) &&
    /^[0-9a-f]{16}$/u.test(value.spanId) && !/^0+$/u.test(value.spanId) &&
    Number.isInteger(value.traceFlags) && value.traceFlags >= 0 && value.traceFlags <= 255;
}

const DECISIONS = new Set(["dvar.action.allowed", "dvar.action.denied", "dvar.action.approval_required", "dvar.runtime.internal_error"]);
const APPROVALS = new Map([
  ["dvar.approval.requested", "requested"], ["dvar.approval.pending", "pending"],
  ["dvar.action.approved", "approved"], ["dvar.action.rejected", "rejected"],
  ["dvar.approval.provider_error", "provider_error"], ["dvar.approval.consumed", "consumed"],
  ["dvar.approval.replay_detected", "replay"]
]);
export interface SafeTelemetryEvent {
  name: "dvar.decision" | "dvar.approval" | "dvar.output";
  attributes: DvarOtelAttributes;
  bytes?: number;
  redactions?: number;
}
export function projectEvent(event: DvarTelemetryEvent): SafeTelemetryEvent | undefined {
  const type = own(event, "type");
  if (typeof type !== "string") return undefined;
  // Output decisions use action.* audit names in v0.7; do not count them twice.
  if (DECISIONS.has(type) && own(event, "outputStatus") !== undefined) {
    const bytes = safeNumber(own(event, "outputBytes"));
    const redactions = safeNumber(own(event, "outputRedactionCount"));
    return { name: "dvar.output", attributes: {
      "dvar.output.status": enumValue(own(event, "outputStatus"), ["allowed", "redacted", "denied"]),
      "dvar.output.content_type": enumValue(own(event, "outputContentType"), ["json", "text", "binary", "unknown"]),
      "dvar.effect": enumValue(own(event, "effect"), ["allow", "deny", "require_approval"]),
      "dvar.observed_effect": enumValue(own(event, "observedEffect"), ["would_allow", "would_deny", "would_require_approval"], "none")
    }, ...(bytes === undefined ? {} : { bytes }), ...(redactions === undefined ? {} : { redactions }) };
  }
  if (DECISIONS.has(type)) return { name: "dvar.decision", attributes: {
    "dvar.effect": enumValue(own(event, "effect"), ["allow", "deny", "require_approval"]),
    "dvar.observed_effect": enumValue(own(event, "observedEffect"), ["would_allow", "would_deny", "would_require_approval"], "none"),
    "dvar.reason_family": reasonFamily(own(event, "reasonCode"))
  } };
  const approval = APPROVALS.get(type);
  if (approval) return { name: "dvar.approval", attributes: {
    "dvar.approval.status": approval,
    "dvar.approval.scope": enumValue(own(event, "approvalScope"), ["once", "session", "task"])
  } };
  // Ignore proposals and integrity/replay mirror events not listed above.
  return undefined;
}
