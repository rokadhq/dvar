import { approvalActionHash } from "../approvals/index.js";
import { sha256 } from "../canonical.js";
import { DvarConfigurationError } from "../errors.js";
import { matchesRecord } from "../matchers.js";
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

const DAY_MS = 86_400_000;
const DEFAULT_SCOPE: DvarRuntimeScope[] = [
  "principal",
  "agent",
  "environment",
  "tool"
];

function positive(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new DvarConfigurationError(`${name} must be a positive finite number`);
  }
}

function nonNegative(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new DvarConfigurationError(`${name} must be a non-negative finite number`);
  }
}

function validate(policy: DvarRuntimeSafetyPolicy): void {
  positive("runtime.maxToolCallsPerTask", policy.maxToolCallsPerTask);
  positive("runtime.maxToolCallsPerSession", policy.maxToolCallsPerSession);
  positive("runtime.maxConsecutiveToolCalls", policy.maxConsecutiveToolCalls);
  positive("runtime.maxDepth", policy.maxDepth);
  nonNegative("runtime.maxRetries", policy.maxRetries);

  const quotaIds = new Set<string>();
  for (const quota of policy.quotas ?? []) {
    if (quotaIds.has(quota.id)) {
      throw new DvarConfigurationError(`Duplicate runtime quota id: ${quota.id}`);
    }
    quotaIds.add(quota.id);
    positive(`runtime quota ${quota.id} limit`, quota.limit);
    positive(`runtime quota ${quota.id} windowSeconds`, quota.windowSeconds);
  }

  const breakerIds = new Set<string>();
  for (const breaker of policy.circuitBreakers ?? []) {
    if (breakerIds.has(breaker.id)) {
      throw new DvarConfigurationError(`Duplicate circuit breaker id: ${breaker.id}`);
    }
    breakerIds.add(breaker.id);
    positive(`circuit breaker ${breaker.id} failureThreshold`, breaker.failureThreshold);
    positive(`circuit breaker ${breaker.id} recoverySeconds`, breaker.recoverySeconds);
    positive(`circuit breaker ${breaker.id} halfOpenMaxCalls`, breaker.halfOpenMaxCalls);
  }
}

function controls(policy: DvarRuntimeSafetyPolicy): string[] {
  const values: string[] = [];
  if (policy.maxToolCallsPerTask !== undefined) values.push("maxToolCallsPerTask");
  if (policy.maxToolCallsPerSession !== undefined) values.push("maxToolCallsPerSession");
  if (policy.maxConsecutiveToolCalls !== undefined) values.push("maxConsecutiveToolCalls");
  if ((policy.quotas?.length ?? 0) > 0) values.push("quotas");
  if (policy.loopDetection !== undefined && policy.loopDetection.enabled !== false) {
    values.push("loopDetection");
  }
  if ((policy.circuitBreakers?.length ?? 0) > 0) values.push("circuitBreakers");
  return values;
}

function scopeValue(action: DvarAction, scope: DvarRuntimeScope): string | undefined {
  switch (scope) {
    case "global": return "global";
    case "principal": return action.principal.id;
    case "agent": return action.agent.id;
    case "tenant": return action.tenant?.id;
    case "session": return action.session?.id;
    case "task": return action.task?.id;
    case "environment": return action.environment;
    case "server": return action.server.id;
    case "tool": return action.tool.name;
    case "destination": return action.destination === undefined
      ? undefined
      : `${action.destination.type}:${action.destination.value}`;
  }
}

function stateKey(
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
  return { key: `${prefix}:${category}:${id}:${sha256(values)}` };
}

function denied(
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

function missing(
  store: DvarRuntimeStore,
  control: string,
  scope: DvarRuntimeScope
): DvarRuntimeSafetyFailure {
  return denied(
    store,
    `runtime.${control}`,
    "runtime.scope_context_missing",
    `Runtime control ${control} requires ${scope} context`,
    control
  );
}

function quotaAmount(
  quota: DvarRuntimeQuotaPolicy,
  usage: DvarRuntimeUsage | undefined
): number | undefined {
  if (quota.metric === "calls") return 1;
  return quota.metric === "cost" ? usage?.cost : usage?.monetaryValue;
}

function sequenceScope(
  action: DvarAction,
  configured?: DvarRuntimeScope[]
): DvarRuntimeScope[] {
  if (configured !== undefined) return configured;
  if (action.task?.id !== undefined) return ["task"];
  if (action.session?.id !== undefined) return ["session"];
  return ["principal", "agent", "environment"];
}

function oscillates(values: string[], count: number): boolean {
  const size = (count + 1) * 2;
  if (values.length < size) return false;
  const tail = values.slice(-size);
  const first = tail[0];
  const second = tail[1];
  return first !== undefined
    && second !== undefined
    && first !== second
    && tail.every((value, index) => value === (index % 2 === 0 ? first : second));
}

async function storeCall<T>(operation: () => T | Promise<T>): Promise<T> {
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
  document: DvarPolicy,
  options: DvarRuntimeSafetyOptions = {}
): DvarRuntimeGuard {
  const policy = document.runtime ?? {};
  validate(policy);

  const store = options.store ?? new InMemoryRuntimeStore();
  const prefix = options.keyPrefix ?? "dvar:v1";
  const now = options.clock ?? Date.now;
  const deploymentInstances = Math.max(options.deploymentInstances ?? 1, 1);
  const statefulControls = controls(policy);
  const distributedRequired = policy.requireDistributedStore === true
    || (deploymentInstances > 1 && statefulControls.length > 0);

  if (distributedRequired && !store.distributed) {
    throw new DvarConfigurationError(
      "Distributed runtime enforcement requires an explicitly configured shared store"
    );
  }

  async function counter(
    action: DvarAction,
    id: string,
    amount: number,
    limit: number,
    windowMs: number,
    scopes: DvarRuntimeScope[]
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    const resolved = stateKey(prefix, "counter", id, scopes, action);
    if (resolved.missing !== undefined) return missing(store, id, resolved.missing);
    const result = await storeCall(() => store.consumeCounter({
      key: resolved.key!, amount, limit, windowMs, nowMs: now()
    }));
    return result.allowed
      ? undefined
      : denied(
          store,
          `runtime.${id}`,
          "quota.exceeded",
          `Runtime limit ${id} exceeded`,
          id,
          { current: result.value, limit: result.limit, resetAtMs: result.resetAtMs }
        );
  }

  async function breakerBefore(
    action: DvarAction,
    breaker: DvarCircuitBreakerPolicy
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    const resolved = stateKey(
      prefix,
      "circuit",
      breaker.id,
      breaker.scope ?? ["server", "tool"],
      action
    );
    if (resolved.missing !== undefined) {
      return missing(store, `circuit.${breaker.id}`, resolved.missing);
    }
    const result = await storeCall(() => store.circuitBefore({
      key: resolved.key!,
      failureThreshold: breaker.failureThreshold,
      recoveryMs: breaker.recoverySeconds * 1000,
      halfOpenMaxCalls: breaker.halfOpenMaxCalls ?? 1,
      nowMs: now()
    }));
    if (result.allowed) return undefined;
    return denied(
      store,
      `runtime.circuit.${breaker.id}`,
      "runtime.circuit_open",
      `Circuit breaker ${breaker.id} is ${result.state}`,
      `circuit.${breaker.id}`,
      {
        current: result.failures,
        limit: breaker.failureThreshold,
        ...(result.retryAtMs !== undefined ? { resetAtMs: result.retryAtMs } : {}),
        circuitState: result.state
      }
    );
  }

  async function detectLoop(
    action: DvarAction,
    loop: DvarLoopDetectionPolicy
  ): Promise<DvarRuntimeSafetyFailure | undefined> {
    if (loop.enabled === false) return undefined;
    const resolved = stateKey(
      prefix,
      "sequence",
      "actions",
      sequenceScope(action, loop.scope),
      action
    );
    if (resolved.missing !== undefined) return missing(store, "loopDetection", resolved.missing);

    const repeatedLimit = loop.maxRepeatedAction ?? 3;
    const oscillationLimit = loop.maxOscillations ?? 3;
    const result = await storeCall(() => store.appendSequence({
      key: resolved.key!,
      value: approvalActionHash(action),
      maxEntries: Math.max(loop.historySize ?? 16, (oscillationLimit + 1) * 2),
      ttlMs: (loop.windowSeconds ?? 300) * 1000,
      nowMs: now()
    }));
    const current = result.values.at(-1);
    const repetitions = result.values.filter((value) => value === current).length;
    if (repetitions > repeatedLimit) {
      return denied(
        store,
        "runtime.loop_detection",
        "runtime.loop_detected",
        `Action fingerprint repeated ${repetitions} times within the loop window`,
        "loopDetection",
        { current: repetitions, limit: repeatedLimit }
      );
    }
    if (oscillates(result.values, oscillationLimit)) {
      return denied(
        store,
        "runtime.loop_detection",
        "runtime.oscillation_detected",
        "Alternating action loop detected",
        "loopDetection",
        { current: oscillationLimit + 1, limit: oscillationLimit }
      );
    }
    return undefined;
  }

  return {
    async before(action): Promise<DvarRuntimeSafetyFailure | undefined> {
      if (document.mode === "off") return undefined;

      const depthLimit = policy.maxDepth;
      const depth = action.trace?.depth ?? 0;
      if (depthLimit !== undefined && depth > depthLimit) {
        return denied(
          store,
          "runtime.max_depth",
          "runtime.depth_exceeded",
          `Action depth ${depth} exceeds ${depthLimit}`,
          "maxDepth",
          { current: depth, limit: depthLimit }
        );
      }

      const retryLimit = policy.maxRetries;
      const retry = action.usage?.retry ?? 0;
      if (retryLimit !== undefined && retry > retryLimit) {
        return denied(
          store,
          "runtime.max_retries",
          "runtime.retry_exceeded",
          `Retry ${retry} exceeds ${retryLimit}`,
          "maxRetries",
          { current: retry, limit: retryLimit }
        );
      }

      for (const breaker of policy.circuitBreakers ?? []) {
        if (!matchesRecord(breaker.when, action)) continue;
        const blocked = await breakerBefore(action, breaker);
        if (blocked !== undefined) return blocked;
      }

      const consecutiveLimit = policy.maxConsecutiveToolCalls;
      if (consecutiveLimit !== undefined) {
        const resolved = stateKey(
          prefix,
          "sequence",
          "consecutive-tools",
          sequenceScope(action),
          action
        );
        if (resolved.missing !== undefined) {
          return missing(store, "maxConsecutiveToolCalls", resolved.missing);
        }
        const result = await storeCall(() => store.appendSequence({
          key: resolved.key!,
          value: action.tool.name,
          maxEntries: consecutiveLimit + 1,
          ttlMs: DAY_MS,
          nowMs: now()
        }));
        let consecutive = 0;
        for (let index = result.values.length - 1; index >= 0; index -= 1) {
          if (result.values[index] !== action.tool.name) break;
          consecutive += 1;
        }
        if (consecutive > consecutiveLimit) {
          return denied(
            store,
            "runtime.max_consecutive_tool_calls",
            "runtime.consecutive_tool_limit",
            `Tool ${action.tool.name} exceeded its consecutive-call limit`,
            "maxConsecutiveToolCalls",
            { current: consecutive, limit: consecutiveLimit }
          );
        }
      }

      if (policy.loopDetection !== undefined) {
        const blocked = await detectLoop(action, policy.loopDetection);
        if (blocked !== undefined) return blocked;
      }

      const taskLimit = policy.maxToolCallsPerTask;
      if (taskLimit !== undefined) {
        const blocked = await counter(
          action,
          "calls_per_task",
          1,
          taskLimit,
          DAY_MS,
          ["task"]
        );
        if (blocked !== undefined) return blocked;
      }

      const sessionLimit = policy.maxToolCallsPerSession;
      if (sessionLimit !== undefined) {
        const blocked = await counter(
          action,
          "calls_per_session",
          1,
          sessionLimit,
          DAY_MS,
          ["session"]
        );
        if (blocked !== undefined) return blocked;
      }

      for (const quota of policy.quotas ?? []) {
        if (!matchesRecord(quota.when, action)) continue;
        const amount = quotaAmount(quota, action.usage);
        if (amount === undefined) {
          if ((quota.onMissing ?? "deny") === "zero") continue;
          return denied(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.usage_missing",
            `Runtime quota ${quota.id} requires ${quota.metric} usage`,
            `quota.${quota.id}`
          );
        }
        if (!Number.isFinite(amount) || amount < 0) {
          return denied(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.usage_invalid",
            `Runtime quota ${quota.id} received an invalid amount`,
            `quota.${quota.id}`
          );
        }
        if (quota.currency !== undefined && action.usage?.currency !== quota.currency) {
          return denied(
            store,
            `runtime.quota.${quota.id}`,
            "runtime.currency_mismatch",
            `Runtime quota ${quota.id} requires currency ${quota.currency}`,
            `quota.${quota.id}`
          );
        }
        const blocked = await counter(
          action,
          `quota.${quota.id}`,
          amount,
          quota.limit,
          quota.windowSeconds * 1000,
          quota.scope ?? DEFAULT_SCOPE
        );
        if (blocked !== undefined) return blocked;
      }
      return undefined;
    },

    async after(action: DvarAction, outcome: DvarRuntimeOutcome): Promise<void> {
      if (document.mode === "off") return;
      for (const breaker of policy.circuitBreakers ?? []) {
        if (!matchesRecord(breaker.when, action)) continue;
        const resolved = stateKey(
          prefix,
          "circuit",
          breaker.id,
          breaker.scope ?? ["server", "tool"],
          action
        );
        if (resolved.missing !== undefined) {
          throw new DvarRuntimeStoreError(
            `Circuit breaker ${breaker.id} requires ${resolved.missing} context`
          );
        }
        await storeCall(() => store.circuitAfter({
          key: resolved.key!,
          failureThreshold: breaker.failureThreshold,
          recoveryMs: breaker.recoverySeconds * 1000,
          halfOpenMaxCalls: breaker.halfOpenMaxCalls ?? 1,
          nowMs: now(),
          success: outcome.success
        }));
      }
    },

    async diagnostics(): Promise<DvarRuntimeDiagnostics> {
      const storeDiagnostics = await store.diagnostics();
      const warnings: string[] = [];
      if (statefulControls.length > 0 && !store.distributed && deploymentInstances === 1) {
        warnings.push("Runtime safety state is process-local");
      }
      if (!storeDiagnostics.healthy) warnings.push("Runtime store health check failed");
      return {
        enabled: statefulControls.length > 0
          || policy.maxDepth !== undefined
          || policy.maxRetries !== undefined,
        statefulControls,
        store: storeDiagnostics,
        deploymentInstances,
        distributedRequired,
        warnings
      };
    }
  };
}
