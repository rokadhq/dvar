import type {
  DvarCircuitBreakerPolicy,
  DvarLoopDetectionPolicy,
  DvarRuntimeDiagnostics,
  DvarRuntimeQuotaPolicy,
  DvarRuntimeSafetyOptions,
  DvarRuntimeSafetySummary,
  DvarRuntimeUsage
} from "./types.js";

declare module "../types.js" {
  interface DvarRuntimePolicy {
    onRuntimeStoreError?: "allow" | "deny";
    requireDistributedStore?: boolean;
    maxToolCallsPerSession?: number;
    maxConsecutiveToolCalls?: number;
    maxRetries?: number;
    quotas?: DvarRuntimeQuotaPolicy[];
    loopDetection?: DvarLoopDetectionPolicy;
    circuitBreakers?: DvarCircuitBreakerPolicy[];
  }

  interface DvarAction {
    usage?: DvarRuntimeUsage;
  }

  interface DvarToolContext {
    usage?: DvarRuntimeUsage;
  }

  interface DvarCreateOptions {
    runtimeSafety?: DvarRuntimeSafetyOptions;
  }

  interface DvarDecision {
    runtimeSafety?: DvarRuntimeSafetySummary;
  }
}

export type { DvarRuntimeDiagnostics };
