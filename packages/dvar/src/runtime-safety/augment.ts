import type {
  DvarCircuitBreakerPolicy,
  DvarCircuitState,
  DvarLoopDetectionPolicy,
  DvarRuntimeDiagnostics,
  DvarRuntimeQuotaPolicy,
  DvarRuntimeSafetyOptions,
  DvarRuntimeSafetySummary,
  DvarRuntimeUsage
} from "./types.js";

declare module "../types.js" {
  interface DvarRuntimePolicy {
    readonly onRuntimeStoreError?: "allow" | "deny";
    readonly requireDistributedStore?: boolean;
    readonly maxToolCallsPerSession?: number;
    readonly maxConsecutiveToolCalls?: number;
    readonly maxRetries?: number;
    readonly quotas?: DvarRuntimeQuotaPolicy[];
    readonly loopDetection?: DvarLoopDetectionPolicy;
    readonly circuitBreakers?: DvarCircuitBreakerPolicy[];
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

  interface DvarApprovalRequest {
    usage?: DvarRuntimeUsage;
    usageHash?: string;
  }

  interface DvarAuditEvent {
    runtimeControl?: string;
    runtimeStore?: string;
    runtimeDistributed?: boolean;
    runtimeCurrent?: number;
    runtimeLimit?: number;
    runtimeResetAt?: string;
    runtimeCircuitState?: DvarCircuitState;
  }
}

export type { DvarRuntimeDiagnostics };
