import type {
  DvarOutputContentType,
  DvarOutputGuard,
  DvarOutputGuardInput,
  DvarOutputGuardOptions,
  DvarOutputGuardPolicy,
  DvarOutputGuardResult,
  DvarOutputGuardSummary,
  DvarOutputRedaction
} from "./types.js";

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "api-key", pattern: /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{12,})["']?/giu },
  { id: "bearer-token", pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})\b/gu },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/gu }
];

function contentType(value: unknown, configured?: DvarOutputContentType, mediaType?: string): DvarOutputContentType {
  if (configured !== undefined) return configured;
  if (mediaType !== undefined) {
    const lower = mediaType.toLowerCase();
    if (lower.includes("json")) return "json";
    if (lower.startsWith("text/") || lower.includes("xml") || lower.includes("html")) return "text";
    if (lower.includes("octet-stream") || lower.startsWith("image/") || lower.startsWith("audio/") || lower.startsWith("video/")) return "binary";
  }
  if (typeof value === "string") return "text";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "binary";
  if (typeof value === "object" && value !== null) return "json";
  return "unknown";
}

function byteLength(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return Buffer.byteLength(JSON.stringify(value));
}

function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function addRedaction(redactions: DvarOutputRedaction[], next: DvarOutputRedaction): void {
  const existing = redactions.find((item) => item.ruleId === next.ruleId && item.source === next.source && item.path === next.path);
  if (existing !== undefined) existing.count += next.count;
  else redactions.push(next);
}

function redactString(
  source: string,
  pattern: RegExp,
  replacement: string,
  redactions: DvarOutputRedaction[],
  ruleId: string,
  redactionSource: DvarOutputRedaction["source"],
  path?: string
): string {
  let count = 0;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const value = source.replace(regex, () => {
    count += 1;
    return replacement;
  });
  if (count > 0) addRedaction(redactions, { ruleId, source: redactionSource, count, ...(path !== undefined ? { path } : {}) });
  return value;
}

function visit(value: unknown, path: string[], visitor: (container: Record<string, unknown>, key: string, path: string[]) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...path, String(index)], visitor));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    visitor(record, key, [...path, key]);
    visit(record[key], [...path, key], visitor);
  }
}

function pathString(path: string[]): string {
  return path.join(".");
}

function applyJsonRedactions<T>(value: T, policy: DvarOutputGuardPolicy, redactions: DvarOutputRedaction[]): T {
  const next = cloneJson(value);
  for (const rule of policy.redact ?? []) {
    const replacement = rule.replacement ?? "[REDACTED]";
    if (rule.field !== undefined) {
      visit(next, [], (container, key, currentPath) => {
        if (key === rule.field) {
          container[key] = replacement;
          addRedaction(redactions, { ruleId: rule.id, source: "field", count: 1, path: pathString(currentPath) });
        }
      });
    }
    if (rule.path !== undefined) {
      const target = rule.path.split(".").filter(Boolean);
      const targetPath = pathString(target);
      const targetKey = target.at(-1);
      if (targetKey !== undefined) {
        visit(next, [], (container, key, currentPath) => {
          if (pathString(currentPath) === targetPath && key === targetKey) {
            container[key] = replacement;
            addRedaction(redactions, { ruleId: rule.id, source: "path", count: 1, path: rule.path! });
          }
        });
      }
    }
    if (rule.pattern !== undefined) {
      const regex = new RegExp(rule.pattern, "gu");
      visit(next, [], (container, key, currentPath) => {
        if (typeof container[key] === "string") {
          container[key] = redactString(container[key], regex, replacement, redactions, rule.id, "pattern", pathString(currentPath));
        }
      });
    }
  }
  if (policy.redactBuiltInSecrets !== false) {
    for (const builtIn of SECRET_PATTERNS) {
      visit(next, [], (container, key, currentPath) => {
        if (typeof container[key] === "string") {
          container[key] = redactString(container[key], builtIn.pattern, "[REDACTED]", redactions, builtIn.id, "built_in_secret", pathString(currentPath));
        }
      });
    }
  }
  return next;
}

function applyTextRedactions(value: string, policy: DvarOutputGuardPolicy, redactions: DvarOutputRedaction[]): string {
  let next = value;
  for (const rule of policy.redact ?? []) {
    if (rule.pattern !== undefined) {
      next = redactString(next, new RegExp(rule.pattern, "gu"), rule.replacement ?? "[REDACTED]", redactions, rule.id, "pattern");
    }
  }
  if (policy.redactBuiltInSecrets !== false) {
    for (const builtIn of SECRET_PATTERNS) {
      next = redactString(next, builtIn.pattern, "[REDACTED]", redactions, builtIn.id, "built_in_secret");
    }
  }
  return next;
}

function denied(
  contentType: DvarOutputContentType,
  bytes: number,
  reasonCode: string,
  message: string,
  redactions: DvarOutputRedaction[],
  maxBytes?: number,
  deniedRuleId?: string
): DvarOutputGuardSummary {
  return {
    status: "denied",
    contentType,
    bytes,
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    redactions,
    ...(deniedRuleId !== undefined ? { deniedRuleId } : {}),
    reasonCode,
    message
  };
}

function maybeDenyPattern(
  serialized: string,
  policy: DvarOutputGuardPolicy,
  contentTypeValue: DvarOutputContentType,
  bytes: number,
  redactions: DvarOutputRedaction[],
  maxBytes?: number
): DvarOutputGuardSummary | undefined {
  for (const rule of policy.deny ?? []) {
    if (new RegExp(rule.pattern, "u").test(serialized)) {
      return denied(
        contentTypeValue,
        bytes,
        "output.deny_pattern",
        rule.message ?? `Output denied by pattern rule: ${rule.id}`,
        redactions,
        maxBytes,
        rule.id
      );
    }
  }
  return undefined;
}

export function createOutputGuard(options: DvarOutputGuardOptions = {}): DvarOutputGuard {
  const policy = options.policy ?? {};
  return {
    filter<T>(input: DvarOutputGuardInput<T>): DvarOutputGuardResult<T> {
      const detectedType = contentType(input.value, input.contentType, input.mediaType);
      const originalBytes = byteLength(input.value);
      const maxBytes = policy.maxBytes;
      const redactions: DvarOutputRedaction[] = [];
      const allowedTypes = policy.allowedContentTypes;

      if (allowedTypes !== undefined && !allowedTypes.includes(detectedType)) {
        return {
          value: input.value,
          summary: denied(detectedType, originalBytes, "output.content_type_denied", `Output content type is not allowed: ${detectedType}`, redactions, maxBytes)
        };
      }
      if (detectedType === "binary" && policy.allowBinary !== true) {
        return {
          value: input.value,
          summary: denied(detectedType, originalBytes, "output.binary_denied", "Binary output is not allowed", redactions, maxBytes)
        };
      }
      if (maxBytes !== undefined && originalBytes > maxBytes) {
        return {
          value: input.value,
          summary: denied(detectedType, originalBytes, "output.size_exceeded", `Output size ${originalBytes} exceeds ${maxBytes}`, redactions, maxBytes)
        };
      }

      let value: unknown = input.value;
      if (detectedType === "json") {
        value = applyJsonRedactions(input.value, policy, redactions);
      } else if (detectedType === "text" && typeof input.value === "string") {
        value = applyTextRedactions(input.value, policy, redactions);
      }
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      const patternDenial = maybeDenyPattern(serialized, policy, detectedType, byteLength(value), redactions, maxBytes);
      if (patternDenial !== undefined) {
        return { value: value as T, summary: patternDenial };
      }
      const filteredBytes = byteLength(value);
      if (maxBytes !== undefined && filteredBytes > maxBytes) {
        return {
          value: value as T,
          summary: denied(detectedType, filteredBytes, "output.size_exceeded", `Filtered output size ${filteredBytes} exceeds ${maxBytes}`, redactions, maxBytes)
        };
      }
      return {
        value: value as T,
        summary: {
          status: redactions.length > 0 ? "redacted" : "allowed",
          contentType: detectedType,
          bytes: filteredBytes,
          ...(maxBytes !== undefined ? { maxBytes } : {}),
          redactions,
          ...(policy.markUntrusted === true ? { untrusted: true } : {})
        }
      };
    }
  };
}
