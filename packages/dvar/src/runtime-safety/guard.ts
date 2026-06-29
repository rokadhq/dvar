import { sha256 } from "../canonical.js";
import { DvarConfigurationError } from "../errors.js";
import { matchesRecord } from "../matchers.js";
import { approvalActionHash } from "../approvals/index.js";
import type { DvarAction, DvarPolicy } from "../types.js";
import { DvarRuntimeStoreError } from "./errors.js";
import { InMemoryRuntimeStore } from "./store.js";
import type {
  DvarCircuitBreakerPolicy,
  DvarLoopDetectionPolicy,
  DvarRuntimeDiagnostics,
  DvarRuntimeGuard,
  DvarRuntimeOutcome,
  DvarRuntimeQuotaPolicy,
  DvarRuntimeSafetyFailure,
  DvarRuntimeSafetyOptions,
  DvarRuntimeSafetyPolicy,
  DvarRuntimeScope,
  DvarRuntimeStore,
  DvarRuntimeUsage
} from "./types.js";

const DEFAULT_STATE_TTL_MS = 86_400_000;
const DEFAULT_SCOPE: DvarRuntimeScope[] = [
  "principal",
  "agent",
  "environment",
  "tool"
];

function runtimePolicy(policy: DvarPolicy): DvarRuntimeSafetyPolicy {
  return policy.runtime ?? {};
}

function statefulControls(policy: DvarRuntimeSafetyPolicy): string[] {
  const controls: string[] = [];
  if (policy.maxToolCallsPerTask !== undefined) controls.push("maxToolCallsPerTask");
  if (policy.maxToolCallsPerSession !== undefined) controls.push("maxToolCallsPerSession");
  if (policy.maxConsecutiveToolCalls !== undefined) controls.push("maxConsecutiveToolCalls");
  if ((policy.quotas?.length ?? 0) > 0) controls.push("quotas");
  if (policy.loopDetection?.enabled !== false && policy.loopDetection !== undefined) controls.push("loopDetection");
  if ((policy.circuitBreakers?.length ?? 0) > 0) controls.push("circuitBreakers");
  return controls;
}

function scopeValue(action: DvarAction, scope: DvarRuntimeScope): string | undefined {
  if (scope === "global") return "global";
  if (scope === "principal") return action.principal.id;
  if (scope === "agent") return action.agent.id;
  if (scope === "tenant") return action.tenant?.id;
  if (scope === "session") return action.session?.id;
  if (scope === "task") return action.task?.id;
  if (scope === "environment") return action.environment;
  if (scope === "server") return action.server.id;
  if (scope === "tool") return action.tool.name;
  if (scope === "destination") {
    return action.destination === undefined
      ? undefined
      : `${action.destination.type}:${action.destination.value}`;
  }
  return undefined;
}

function keyFor(
  prefix: string,
  category: string,
  id: string,
  scopes: DvarRuntimeScope[],
  action: DvarAction
): { key?: string; missing?: DvarRuntimeScope } {
  const values: Record<string, string> = {};
  for (const scope of scopes) {
    const value = scopeValue(action, scope);
    if (value === undefined || value === "") return { missing: scope };
    values[scope] = value;
  }
  return {
    key: `${prefix}:${category}:${id}:${sha256(values)}`
  };
}

function failure(
  store: DvarRuntimeStore,
  ruleId: string,
  reasonCode: string,
  message: string,
  control: string,
  details: {
    current?: number;
    limit?: number;
    resetAtMs?: number;
    circuitState?: "closed" | "open" | "half_open";
  } = {}
): DvarRuntimeSafetyFailure {
  return {
    ruleId,
    reasonCode,
    message,
    summary: {
      status: "denied",
      control,
      store: store.kind,
      distributed: store.distributed,
      ...(details.current !== undefined ? { current: details.current } : {}),
      ...(details.limit !== undefined ? { limit: details.limit } : {}),
      ...(details.resetAtMs !== undefined
        ? { resetAt: new Date(details.resetAtMs).toISOString() }
        : {}),
      ...(details.circuitState !== undefined
        ? { circuitState: details.circuitState }
        : {})
    }
  };
}

function missingScopeFailure(
  store: DvarRuntimeStore,
  control: string,
  scope: DvarRuntimeScope
): DvarRuntimeSafetyFailure {
  return failure(
    store,
    `runtime.${control}`,
    "runtime.scope_context_missing",
    `Runtime control ${control} requires ${scope} context`,
    control
  );
}

function usageAmount(
  quota: DvarRuntimeQuotaPolicy,
  usage: DvarRuntimeUsage | undefined
): number | undefined {
  if (quota.metric === "calls") return 1;
  if (quota.metric === "cost") return usage?.cost;
  return usage?.monetaryValue;
}

function loopScope(
  action: DvarAction,
  configured: DvarRuntimeScope[] | undefined
): DvarRuntimeScope[] {
  if (configured !== undefined) return configured;
  if (action.task?.id !== undefined) return ["task"];
  if (action.session?.id !== undefined) return ["session"];
  return ["principal", "agent", "environment"];
}

function isOscillation(values: string[], maxOscillations: number): boolean {
  const length = (maxOscillations + 1) * 2;
  if (values.length < length) return false;
  const tail = values.slice(-length);
  const first = tail[0];
  const second = tail[1];
  if (first === undefined || second === undefined || first === second) return false;
  return tail.every((value, index) => value === (index % 2 === 0 ? first : second));
}

function validatePositive(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new DvarConfigurationError(`${name} must be a positive finite number`);
  }
}

function validateNonNegative(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new DvarConfigurationError(`${name} must be a non-negative finite number`);
  }
}

function validateConfiguration(policy: DvarRuntimeSafetyPolicy): void {
  validatePositive("runtime.maxToolCallsPerTask", policy.maxToolCallsPerTask);
  validatePositive("runtime.maxToolCallsPerSession", policy.maxToolCallsPerSession);
  validatePositive("runtime.maxConsecutiveToolCalls", policy.maxConsecutiveToolCalls);
  validatePositive("runtime.maxDepth", policy.maxDepth);
  validateNonNegative("runtime.maxRetries", policy.maxRetries);
  const ids = new Set<string>();
  for (const quota of policy.quotas ?? []) {
    if (ids.has(quota.id)) throw new DvarConfigurationError(`Duplicate runtime quota id: ${quota.id}`);
    ids.add(quota.id);
    validatePositive(`runtime quota ${quota.id} limit`, quota.limit);
    validatePositive(`runtime quota ${quota.id} windowSeconds`, quota.windowSeconds);
  }
  const breakerIds = new Set<string>();
  for (const breaker of policy.circuitBreakers ?? []) {
    if (breakerIds.has(breaker.id)) {
      throw new DvarConfigurationError(`Duplicate circuit breaker id: ${breaker.id}`);
    }
    breakerIds.add(breaker.id);
    validatePositive(`circuit breaker ${breaker.id} failureThreshold`, breaker.failureThreshold);
    validatePositive(`circuit breaker ${breaker.id} recoverySeconds`, breaker.recoverySeconds);
    validatePositive(`circuit breaker ${breaker.id} halfOpenMaxCalls`, breaker.halfOpenMaxCalls);
  }
}

async function callStore<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DvarRuntimeStoreError(
      error instanceof Error ? error.message : "Runtime store operation failed",
      error instanceof Error ? { cause: error } : undefined
    );
  }
}

export function createRuntimeGuard(
  policyDocument: DvarPolicy,
  options: DvarRuntimeSafetyOptions = {}
): DvarRuntimeGuard {
  const policy = runtimePolicy(policyDocument);
  validateConfiguration(policy);
  const store = options.store ?? new InMemoryRuntimeStore();
  const prefix = options.keyPrefix ?? "dvar:v1";
  const clock = options.clock ?? Date.now;
  const deploymentInstances = Math.max(options.deploymentInstances ?? 1, 1);
  const controls = statefulControls(policy);
  const distributedRequired = policy.requireDistributedStore === true
    || (deploymentInstances > 1 && controls.length > 0);
  if (distributedRequired && !store.distributed) {
    throw new DvarConfigurationError(
      "Distributed runtime enforcement requires an explicitly configured shared store"
    );
  }

  async function counter(
    action: DvarAction,
    input: {
      id: string;
      amount: number;
      limit: number;
      windowMs: number;
      scopes: DvarRuntimeScope[];
      reasonCode?: string;
    }
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    const resolved = keyFor(prefix, "counter", input.id, input.scopes, action);
    if (resolved.missing !== undefined) {
      return missingScopeFailure(store, input.id, resolved.missing);
    }
    const result = await callStore(() => store.consumeCounter({
      key: resolved.key!,
      amount: input.amount,
      limit: input.limit,
      windowMs: input.windowMs,
      nowMs: clock()
    }));
    if (result.allowed) return undefined;
    return failure(
      store,
      `runtime.${input.id}`,
      input.reasonCode ?? "quota.exceeded",
      `Runtime limit ${input.id} exceeded`,
      input.id,
      {
        current: result.value,
        limit: result.limit,
        resetAtMs: result.resetAtMs
      }
    );
  }

  async function circuitBefore(
    action: DvarAction,
    breaker: DvarCircuitBreakerPolicy
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    const scopes = breaker.scope ?? ["server", "tool"];
    const resolved = keyFor(prefix, "circuit", breaker.id, scopes, action);
    if (resolved.missing !== undefined) {
      return missingScopeFailure(store, `circuit.${breaker.id}`, resolved.missing);
    }
    const result = await callStore(() => store.circuitBefore({
      key: resolved.key!,
      failureThreshold: breaker.failureThreshold,
      recoveryMs: breaker.recoverySeconds * 1000,
      halfOpenMaxCalls: breaker.halfOpenMaxCalls ?? 1,
      nowMs: clock()
    }));
    if (result.allowed) return undefined;
    return failure(
      store,
      `runtime.circuit.${breaker.id}`,
      "runtime.circuit_open",
      `Circuit breaker ${breaker.id} is ${result.state}`,
      `circuit.${breaker.id}`,
      {
        current: result.failures,
        limit: breaker.failureThreshold,
        ...(result.retryAtMs !== undefined
          ? { resetAtMs: result.retryAtMs }
          : {}),
        circuitState: result.state
      }
    );
  }

  async function checkLoop(
    action: DvarAction,
    loop: DvarLoopDetectionPolicy
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    if (loop.enabled === false) return undefined;
    const scopes = loopScope(action, loop.scope);
    const resolved = keyFor(prefix, "sequence", "actions", scopes, action);
    if (resolved.missing !== undefined) {
      return missingScopeFailure(store, "loopDetection", resolved.missing);
    }
    const historySize = loop.historySize ?? 16;
    const maxRepeatedAction = loop.maxRepeatedAction ?? 3;
    const maxOscillations = loop.maxOscillations ?? 3;
    const result = await callStore(() => store.appendSequence({
      key: resolved.key!,
      value: approvalActionHash(action),
      maxEntries: Math.max(historySize, (maxOscillations + 1) * 2),
      ttlMs: (loop.windowSeconds ?? 300) * 1000,
      nowMs: clock()
    }));
    const current = result.values[result.values.length - 1];
    const repetitions = result.values.filter((value) => value === current).length;
    if (repetitions > maxRepeatedAction) {
      return failure(
        store,
        "runtime.loop_detection",
        "runtime.loop_detected",
        `Action fingerprint repeated ${repetitions} times within the loop window`,
        "loopDetection",
        { current: repetitions, limit: maxRepeatedAction }
      );
    }
    if (isOscillation(result.values, maxOscillations)) {
      return failure(
        store,
        "runtime.loop_detection",
        "runtime.oscillation_detected",
        "Alternating action loop detected",
        "loopDetection",
        { current: maxOscillations + 1, limit: maxOscillations }
      );
    }
    return undefined;
  }

  return {
    async before(action: DvarAction): Promise<DvarRuntimeSafetyFailure | undefined> {
      if (policyDocument.mode === "off") return undefined;
      const depth = action.trace?.depth ?? 0;
      if (policy.maxDepth !== undefined && depth > policy.maxDepth) {
        return failure(
          store,
          "runtime.max_depth",
          "runtime.depth_exceeded",
          `Action depth ${depth} exceeds ${policy.maxDepth}`,
          "maxDepth",
          { current: depth, limit: policy.maxDepth }
        );
      }
      const retry = action.usage?.retry ?? 0;
      if (policy.maxRetries !== undefined && retry > policy.maxRetries) {
        return failure(
          store,
          "runtime.max_retries",
          "runtime.retry_exceeded",
          `Retry ${retry} exceeds ${policy.maxRetries}`,
          "maxRetries",
          { current: retry, limit: policy.maxRetries }
        );
      }

      for (const breaker of policy.circuitBreakers ?? []) {
        if (!matchesRecord(breaker.when, action)) continue;
        const blocked = await circuitBefore(action, breaker);
        if (blocked !== undefined) return blocked;
      }

      if (policy.maxConsecutiveToolCalls !== undefined) {
        const scopes = loopScope(action, undefined);
        const resolved = keyFor(prefix, "sequence", "consecutive-tools", scopes, action);
        if (resolved.missing !== undefined) {
          return missingScopeFailure(store, "maxConsecutiveToolCalls", resolved.missing);
        }
        const result = await callStore(() => store.appendSequence({
          key: resolved.key!,
          value: action.tool.name,
          maxEntries: policy.maxConsecutiveToolCalls + 1,
          ttlMs: DEFAULT_STATE_TTL_MS,
          nowMs: clock()
        }));
        let consecutive = 0;
        for (let index = result.values.length - 1; index >= 0; index -= 1) {
          if (result.values[index] !== action.tool.name) break;
          consecutive += 1;
        }
        if (consecutive > policy.maxConsecutiveToolCalls) {
          return failure(
            store,
            "runtime.max_consecutive_tool_calls",
            "runtime.consecutive_tool_limit",
            `Tool ${action.tool.name} exceeded its consecutive-call limit`,
            "maxConsecutiveToolCalls",
            { current: consecutive, limit: policy.maxConsecutiveToolCalls }
          );
        }
      }

      if (policy.loopDetection !== undefined) {
        const blocked = await checkLoop(action, policy.loopDetection);
        if (blocked !== undefined) return blocked;
      }

      if (policy.maxToolCallsPerTask !== undefined) {
        const blocked = await counter(action, {
          id: "calls_per_task",
          amount: 1,
          limit: policy.maxToolCallsPerTask,
          windowMs: DEFAULT_STATE_TTL_MS,
          scopes: ["task"],
          reasonCode: "quota.exceeded"
        });
        if (blocked !== undefined) return blocked;
      }
      if (policy.maxToolCallsPerSession !== undefined) {
        const blocked = await counter(action, {
          id: "calls_per_session",
          amount: 1,
          limit: policy.maxToolCallsPerSession,
          windowMs: DEFAULT_STATE_TTL_MS,
          scopes: ["session"],
          reasonCode: "quota.exceeded"
        });
        if (blocked !== undefined) return blocked;
      }

      for (const quota of policy.quotas ?? []) {
        if (!matchesRecord(quota.when, action)) continue;
        const amount = usageAmount(quota, action.usage);
        if (amount === undefined) {
          if ((quota.onMissing ?? "deny") === "zero") continue;
          return failure(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.usage_missing",
            `Runtime quota ${quota.id} requires ${quota.metric} usage`,
            `quota.${quota.id}`
          );
        }
        if (!Number.isFinite(amount) || amount < 0) {
          return failure(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.usage_invalid",
            `Runtime quota ${quota.id} received an invalid amount`,
            `quota.${quota.id}`
          );
        }
        if (
          quota.currency !== undefined
          && action.usage?.currency !== quota.currency
        ) {
          return failure(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.currency_mismatch",
            `Runtime quota ${quota.id} requires currency ${quota.currency}`,
            `quota.${quota.id}`
          );
        }
        const blocked = await counter(action, {
          id: `quota.${quota.id}`,
          amount,
          limit: quota.limit,
          windowMs: quota.windowSeconds * 1000,
          scopes: quota.scope ?? DEFAULT_SCOPE,
          reasonCode: "quota.exceeded"
        });
        if (blocked !== undefined) return blocked;
      }
      return undefined;
    },

    async after(action: DvarAction, outcome: DvarRuntimeOutcome): Promise<void> {
      if (policyDocument.mode === "off") return;
      for (const breaker of policy.circuitBreakers ?? []) {
        if (!matchesRecord(breaker.when, action)) continue;
        const scopes = breaker.scope ?? ["server", "tool"];
        const resolved = keyFor(prefix, "circuit", breaker.id, scopes, action);
        if (resolved.missing !== undefined) {
          throw new DvarRuntimeStoreError(
            `Circuit breaker ${breaker.id} requires ${resolved.missing} context`
          );
        }
        await callStore(() => store.circuitAfter({
          key: resolved.key!,
          failureThreshold: breaker.failureThreshold,
          recoveryMs: breaker.recoverySeconds * 1000,
          halfOpenMaxCalls: breaker.halfOpenMaxCalls ?? 1,
          nowMs: clock(),
          success: outcome.success
        }));
      }
    },

    async diagnostics(): Promise<DvarRuntimeDiagnostics> {
      const diagnostics = await store.diagnostics();
      const warnings: string[] = [];
      if (controls.length > 0 && !store.distributed && deploymentInstances === 1) {
        warnings.push("Runtime safety state is process-local");
      }
      if (!diagnostics.healthy) warnings.push("Runtime store health check failed");
      return {
        enabled: controls.length > 0 || policy.maxDepth !== undefined || policy.maxRetries !== undefined,
        statefulControls: controls,
        store: diagnostics,
        deploymentInstances,
        distributedRequired,
        warnings
      };
    }
  };
}
