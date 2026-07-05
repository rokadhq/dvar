import type { DvarAction } from "../types.js";

export type DvarOutputContentType = "json" | "text" | "binary" | "unknown";
export type DvarOutputGuardStatus = "allowed" | "redacted" | "denied";
export type DvarOutputRedactionSource = "field" | "path" | "pattern" | "built_in_secret";

export interface DvarOutputRedactionRule {
  id: string;
  field?: string;
  path?: string;
  pattern?: string;
  replacement?: string;
}

export interface DvarOutputDenyRule {
  id: string;
  pattern: string;
  message?: string;
}

export interface DvarOutputGuardPolicy {
  maxBytes?: number;
  allowBinary?: boolean;
  allowedContentTypes?: DvarOutputContentType[];
  redactBuiltInSecrets?: boolean;
  markUntrusted?: boolean;
  redact?: DvarOutputRedactionRule[];
  deny?: DvarOutputDenyRule[];
}

export interface DvarOutputGuardOptions {
  policy?: DvarOutputGuardPolicy;
}

export interface DvarOutputRedaction {
  ruleId: string;
  source: DvarOutputRedactionSource;
  path?: string;
  count: number;
}

export interface DvarOutputGuardSummary {
  status: DvarOutputGuardStatus;
  contentType: DvarOutputContentType;
  bytes: number;
  maxBytes?: number;
  redactions: DvarOutputRedaction[];
  deniedRuleId?: string;
  reasonCode?: string;
  message?: string;
  untrusted?: boolean;
}

export interface DvarOutputGuardInput<T = unknown> {
  action?: DvarAction;
  value: T;
  contentType?: DvarOutputContentType;
  mediaType?: string;
  source?: "tool" | "mcp" | "stdio" | "custom";
}

export interface DvarOutputGuardResult<T = unknown> {
  value: T;
  summary: DvarOutputGuardSummary;
}

export interface DvarOutputGuard {
  filter<T>(input: DvarOutputGuardInput<T>): DvarOutputGuardResult<T>;
}
