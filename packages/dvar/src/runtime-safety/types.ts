import type { DvarAction, DvarMatchValue } from "../types.js";

export type DvarRuntimeScope =
  | "global"
  | "principal"
  | "agent"
  | "tenant"
  | "session"
  | "task"
  | "environment"
  | "server"
  | "tool"
  | "destination";

export type DvarRuntimeQuotaMetric = "calls" | "cost" | "monetary";
export type DvarCircuitState = "closed" | "open" | "half_open";

export interface DvarRuntimeUsage {
  retry?: number;
  cost?: number;
  monetaryValue?: number;
  currency?: string;
}

export interface DvarRuntimeQuotaPolicy {
  id: string;
  metric: DvarRuntimeQuotaMetric;
  limit: number;
  windowSeconds: number;
  scope?: DvarRuntimeScope[];
  currency?: string;
  onMissing?: "zero" | "deny";
  when?: Record<string, DvarMatchValue>;
}

export interface DvarLoopDetectionPolicy {
  enabled?: boolean;
  windowSeconds?: number;
  historySize?: number;
  maxRepeatedAction?: number;
  maxOscillations?: number;
  scope?: DvarRuntimeScope[];
}

export interface DvarCircuitBreakerPolicy {
  id: string;
  failureThreshold: number;
  recoverySeconds: number;
  halfOpenMaxCalls?: number;
  scope?: DvarRuntimeScope[];
  when?: Record<string, DvarMatchValue>;
}

export interface DvarRuntimeSafetyPolicy {
  onRuntimeStoreError?: "allow" | "deny";
  requireDistributedStore?: boolean;
  maxToolCallsPerTask?: number;
  maxToolCallsPerSession?: number;
  maxConsecutiveToolCalls?: number;
  maxDepth?: number;
  maxRetries?: number;
  quotas?: DvarRuntimeQuotaPolicy[];
  loopDetection?: DvarLoopDetectionPolicy;
  circuitBreakers?: DvarCircuitBreakerPolicy[];
}

export interface DvarRuntimeSafetyOptions {
  store?: DvarRuntimeStore;
  keyPrefix?: string;
  deploymentInstances?: number;
  clock?: () => number;
}

export interface DvarRuntimeSafetySummary {
  status: "allowed" | "denied" | "store_error";
  control: string;
  store: string;
  distributed: boolean;
  current?: number;
  limit?: number;
  resetAt?: string;
  circuitState?: DvarCircuitState;
}

export interface DvarRuntimeSafetyFailure {
  ruleId: string;
  reasonCode: string;
  message: string;
  summary: DvarRuntimeSafetySummary;
}

export interface DvarRuntimeOutcome {
  success: boolean;
  durationMs?: number;
  errorCode?: string;
}

export interface DvarRuntimeStoreDiagnostics {
  kind: string;
  distributed: boolean;
  healthy: boolean;
  checkedAt: string;
  latencyMs?: number;
  message?: string;
}

export interface DvarRuntimeDiagnostics {
  enabled: boolean;
  statefulControls: string[];
  store: DvarRuntimeStoreDiagnostics;
  deploymentInstances: number;
  distributedRequired: boolean;
  warnings: string[];
}

export interface DvarRuntimeCounterRequest {
  key: string;
  amount: number;
  limit: number;
  windowMs: number;
  nowMs: number;
}

export interface DvarRuntimeCounterResult {
  allowed: boolean;
  value: number;
  limit: number;
  resetAtMs: number;
}

export interface DvarRuntimeSequenceRequest {
  key: string;
  value: string;
  maxEntries: number;
  ttlMs: number;
  nowMs: number;
}

export interface DvarRuntimeSequenceResult {
  values: string[];
}

export interface DvarRuntimeCircuitRequest {
  key: string;
  failureThreshold: number;
  recoveryMs: number;
  halfOpenMaxCalls: number;
  nowMs: number;
}

export interface DvarRuntimeCircuitResult {
  allowed: boolean;
  state: DvarCircuitState;
  failures: number;
  retryAtMs?: number;
}

export interface DvarRuntimeCircuitOutcomeRequest
  extends DvarRuntimeCircuitRequest {
  success: boolean;
}

export interface DvarRuntimeStore {
  readonly kind: string;
  readonly distributed: boolean;
  consumeCounter(
    request: DvarRuntimeCounterRequest
  ): DvarRuntimeCounterResult | Promise<DvarRuntimeCounterResult>;
  appendSequence(
    request: DvarRuntimeSequenceRequest
  ): DvarRuntimeSequenceResult | Promise<DvarRuntimeSequenceResult>;
  circuitBefore(
    request: DvarRuntimeCircuitRequest
  ): DvarRuntimeCircuitResult | Promise<DvarRuntimeCircuitResult>;
  circuitAfter(
    request: DvarRuntimeCircuitOutcomeRequest
  ): DvarRuntimeCircuitResult | Promise<DvarRuntimeCircuitResult>;
  diagnostics(): DvarRuntimeStoreDiagnostics | Promise<DvarRuntimeStoreDiagnostics>;
}

export interface DvarRedisEvalClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
  ping?(): Promise<unknown>;
}

export interface DvarRedisRuntimeStoreOptions {
  client: DvarRedisEvalClient;
  kind?: "redis" | "valkey" | string;
}

export interface DvarRuntimeGuard {
  before(action: DvarAction): Promise<DvarRuntimeSafetyFailure | undefined>;
  after(action: DvarAction, outcome: DvarRuntimeOutcome): Promise<void>;
  diagnostics(): Promise<DvarRuntimeDiagnostics>;
}
