import type {
  DvarOutputGuardOptions,
  DvarOutputGuardSummary
} from "./types.js";

declare module "../types.js" {
  interface DvarCreateOptions {
    outputGuard?: DvarOutputGuardOptions;
  }

  interface DvarDecision {
    outputSafety?: DvarOutputGuardSummary;
  }

  interface DvarAuditEvent {
    outputStatus?: DvarOutputGuardSummary["status"];
    outputContentType?: DvarOutputGuardSummary["contentType"];
    outputBytes?: number;
    outputMaxBytes?: number;
    outputRedactionCount?: number;
    outputDeniedRuleId?: string;
    outputUntrusted?: boolean;
  }
}
