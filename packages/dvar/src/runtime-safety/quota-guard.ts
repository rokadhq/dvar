import "./quota-augment.js";
import { approvalActionHash } from "../approvals/index.js";
import { sha256 } from "../canonical.js";
import { DvarConfigurationError } from "../errors.js";
import { matchesRecord } from "../matchers.js";
import type { DvarAction, DvarPolicy } from "../types.js";
import { DvarRuntimeStoreError } from "./errors.js";
import { createRuntimeGuard as createLegacyRuntimeGuard } from "./guard.js";
import { prepareReservation, type DvarQuotaCounter, type DvarQuotaReservationRequest, type DvarQuotaReservationResult } from "./quota-reservations.js";
import type { DvarRuntimeGuard, DvarRuntimeSafetyFailure, DvarRuntimeSafetyOptions, DvarRuntimeScope } from "./types.js";

const DAY_MS = 86_400_000;
const DEFAULT_SCOPE: DvarRuntimeScope[] = ["principal", "agent", "environment", "tool"];

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
    case "destination": return action.destination === undefined ? undefined : `${action.destination.type}:${action.destination.value}`;
  }
}

/** Preserve the legacy path unless atomic quota accounting is explicitly configured. */
export function createRuntimeGuard(document: DvarPolicy, options: DvarRuntimeSafetyOptions = {}): DvarRuntimeGuard {
  const reservations = options.quotaReservations;
  if (reservations === undefined) return createLegacyRuntimeGuard(document, options);
  if (typeof reservations.reserve !== "function" || typeof reservations.kind !== "string" || typeof reservations.distributed !== "boolean") {
    throw new DvarConfigurationError("Invalid quota reservation store");
  }
  const policy = document.runtime ?? {};
  const { maxToolCallsPerTask, maxToolCallsPerSession, quotas, ...rest } = policy;
  const quotaControls = [
    ...(maxToolCallsPerTask === undefined ? [] : ["maxToolCallsPerTask"]),
    ...(maxToolCallsPerSession === undefined ? [] : ["maxToolCallsPerSession"]),
    ...((quotas?.length ?? 0) === 0 ? [] : ["quotas"])
  ];
  if (!Number.isSafeInteger(options.deploymentInstances ?? 1) || (options.deploymentInstances ?? 1) < 1) {
    throw new DvarConfigurationError("deploymentInstances must be a positive integer");
  }
  const quotaIds = new Set<string>();
  if ((quotas?.length ?? 0) > 128) throw new DvarConfigurationError("Too many runtime quotas");
  for (const quota of quotas ?? []) {
    if (quotaIds.has(quota.id)) throw new DvarConfigurationError("Duplicate runtime quota ID");
    quotaIds.add(quota.id);
    try { prepareReservation({ requestId: "validation", binding: "configuration", counters: [{ key: quota.id, amount: 0, limit: quota.limit, windowMs: quota.windowSeconds * 1000 }] }); }
    catch { throw new DvarConfigurationError("Invalid atomic runtime quota configuration"); }
  }
  for (const limit of [maxToolCallsPerTask, maxToolCallsPerSession]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new DvarConfigurationError("Call limits must be positive integers");
  }
  const required = policy.requireDistributedStore === true || (options.deploymentInstances ?? 1) > 1;
  if (quotaControls.length > 0 && required && !reservations.distributed) {
    throw new DvarConfigurationError("Distributed quota accounting requires a shared reservation store");
  }
  const otherStateful = rest.maxConsecutiveToolCalls !== undefined ||
    (rest.loopDetection !== undefined && rest.loopDetection.enabled !== false) || (rest.circuitBreakers?.length ?? 0) > 0;
  const base = createLegacyRuntimeGuard({
    ...document,
    runtime: { ...rest, requireDistributedStore: (otherStateful || quotaControls.length === 0) && rest.requireDistributedStore === true }
  }, options);
  const prefix = options.keyPrefix ?? "dvar:v1";
  if (typeof prefix !== "string" || prefix.length === 0) throw new DvarConfigurationError("Invalid runtime key prefix");

  function failure(control: string, reasonCode: string, details: { current?: number; limit?: number; resetAt?: string } = {}): DvarRuntimeSafetyFailure {
    return {
      ruleId: `runtime.${control}`, reasonCode,
      message: `Runtime quota authorization rejected: ${reasonCode}`,
      summary: { status: "denied", control, store: reservations!.kind, distributed: reservations!.distributed, ...details }
    };
  }

  return {
    async before(action) {
      if (document.mode === "off") return undefined;
      const counters: DvarQuotaCounter[] = [];
      const controls: string[] = [];
      function add(id: string, amount: number, limit: number, windowMs: number, scopes: DvarRuntimeScope[]): DvarRuntimeSafetyFailure | undefined {
        if (scopes.length === 0 || new Set(scopes).size !== scopes.length) return failure(id, "runtime.quota_scope_invalid");
        const values: Record<string, string> = {};
        for (const scope of scopes) {
          const value = scopeValue(action, scope);
          if (value === undefined || value === "") return failure(id, "runtime.scope_context_missing");
          values[scope] = value;
        }
        counters.push({ key: `${prefix}:${id}:${sha256(values)}`, amount, limit, windowMs });
        controls.push(id);
        return undefined;
      }
      // Bare task/session IDs are not assumed to be globally unique across tenants.
      const identityScope: DvarRuntimeScope[] = ["principal", "agent", "environment", ...(action.tenant === undefined ? [] : ["tenant" as const])];
      if (maxToolCallsPerTask !== undefined) {
        const denied = add("calls_per_task", 1, maxToolCallsPerTask, DAY_MS, [...identityScope, "task"]);
        if (denied !== undefined) return denied;
      }
      if (maxToolCallsPerSession !== undefined) {
        const denied = add("calls_per_session", 1, maxToolCallsPerSession, DAY_MS, [...identityScope, "session"]);
        if (denied !== undefined) return denied;
      }
      for (const quota of quotas ?? []) {
        if (!matchesRecord(quota.when, action)) continue;
        const amount = quota.metric === "calls" ? 1 : quota.metric === "cost" ? action.usage?.cost : action.usage?.monetaryValue;
        if (amount === undefined) {
          if (quota.onMissing === "zero") continue;
          return failure(`quota.${quota.id}`, "runtime.usage_missing");
        }
        if (!Number.isFinite(amount) || amount < 0) return failure(`quota.${quota.id}`, "runtime.usage_invalid");
        if (quota.currency !== undefined && action.usage?.currency !== quota.currency) return failure(`quota.${quota.id}`, "runtime.currency_mismatch");
        const scopes = quota.scope ?? [...DEFAULT_SCOPE, ...(action.tenant === undefined ? [] : ["tenant" as const])];
        const denied = add(`quota.${quota.id}`, amount, quota.limit, quota.windowSeconds * 1000, scopes);
        if (denied !== undefined) return denied;
      }
      if (typeof action.id !== "string" || action.id.length === 0) return failure("quota_reservation", "runtime.quota_request_invalid");
      const request: DvarQuotaReservationRequest = {
        requestId: sha256({ prefix, id: action.id, principal: action.principal.id, agent: action.agent.id, tenant: action.tenant?.id ?? null, environment: action.environment }),
        binding: sha256({ action: approvalActionHash(action), policy: document }),
        counters
      };
      if (counters.length > 0) {
        try { prepareReservation(request); }
        catch { return failure("quota_reservation", "runtime.quota_request_invalid"); }
      }
      const blocked = await base.before(action);
      if (blocked !== undefined || counters.length === 0) return blocked;
      let result: DvarQuotaReservationResult;
      try { result = await reservations.reserve(request); }
      catch { throw new DvarRuntimeStoreError("Atomic quota reservation store is unavailable"); }
      if (result.status !== "conflict") {
        if (!Array.isArray(result.counters) || result.counters.length !== counters.length || result.counters.some((snapshot, index) =>
          !Number.isFinite(snapshot.value) || snapshot.value < 0 || snapshot.limit !== counters[index]!.limit ||
          !Number.isSafeInteger(snapshot.resetAtMs) || snapshot.resetAtMs < 0 || snapshot.resetAtMs > 8_640_000_000_000_000 ||
          (result.status === "reserved" && snapshot.value > snapshot.limit))) {
          throw new DvarRuntimeStoreError("Invalid atomic quota reservation reply");
        }
      }
      if (result.status === "reserved") return undefined;
      if (result.status === "replayed") return failure("quota_reservation", "runtime.reservation_replayed");
      if (result.status === "conflict") return failure("quota_reservation", "runtime.reservation_conflict");
      const index = result.deniedIndex;
      const snapshot = index === undefined ? undefined : result.counters[index];
      if (result.status !== "denied" || index === undefined || snapshot === undefined || controls[index] === undefined) {
        throw new DvarRuntimeStoreError("Invalid atomic quota reservation reply");
      }
      return failure(controls[index], "quota.exceeded", { current: snapshot.value, limit: snapshot.limit, resetAt: new Date(snapshot.resetAtMs).toISOString() });
    },
    after: (action, outcome) => base.after(action, outcome),
    async diagnostics() {
      const value = await base.diagnostics();
      return {
        ...value,
        enabled: value.enabled || quotaControls.length > 0,
        statefulControls: [...value.statefulControls, ...quotaControls],
        distributedRequired: value.distributedRequired || (quotaControls.length > 0 && required),
        quotaReservations: { kind: reservations.kind, distributed: reservations.distributed, mode: "atomic" as const },
        warnings: [...value.warnings, ...(!reservations.distributed ? ["Atomic quota state is process-local"] : [])]
      };
    }
  };
}
