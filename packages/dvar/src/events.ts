import type { DvarAction, DvarAuditEvent, DvarDecision, DvarEventSink } from "./types.js";

export async function emitSafely(
  sink: DvarEventSink | undefined,
  event: DvarAuditEvent
): Promise<void> {
  if (sink === undefined) return;
  try {
    await sink(event);
  } catch {
    // Telemetry is isolated from the decision path by default.
  }
}

export function proposedEvent(action: DvarAction, actionHash: string): DvarAuditEvent {
  return {
    type: "dvar.action.proposed",
    timestamp: new Date().toISOString(),
    actionId: action.id,
    principalId: action.principal.id,
    agentId: action.agent.id,
    ...(action.tenant?.id !== undefined ? { tenantId: action.tenant.id } : {}),
    environment: action.environment,
    serverId: action.server.id,
    toolName: action.tool.name,
    capabilities: action.tool.capabilities ?? [],
    actionHash
  };
}

export function decisionEvent(action: DvarAction, decision: DvarDecision): DvarAuditEvent {
  const type = decision.effect === "deny"
    ? "dvar.action.denied"
    : decision.effect === "require_approval"
      ? "dvar.action.approval_required"
      : "dvar.action.allowed";
  const runtime = decision.runtimeSafety;

  return {
    type,
    timestamp: new Date().toISOString(),
    actionId: action.id,
    decisionId: decision.id,
    principalId: action.principal.id,
    agentId: action.agent.id,
    ...(action.tenant?.id !== undefined ? { tenantId: action.tenant.id } : {}),
    environment: action.environment,
    serverId: action.server.id,
    toolName: action.tool.name,
    capabilities: action.tool.capabilities ?? [],
    actionHash: decision.actionHash,
    effect: decision.effect,
    ...(decision.observedEffect !== undefined ? { observedEffect: decision.observedEffect } : {}),
    ruleId: decision.ruleId,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    policyHash: decision.policyHash,
    risk: decision.risk,
    durationMs: decision.durationMs,
    ...(runtime !== undefined
      ? {
          runtimeControl: runtime.control,
          runtimeStore: runtime.store,
          runtimeDistributed: runtime.distributed,
          ...(runtime.current !== undefined ? { runtimeCurrent: runtime.current } : {}),
          ...(runtime.limit !== undefined ? { runtimeLimit: runtime.limit } : {}),
          ...(runtime.resetAt !== undefined ? { runtimeResetAt: runtime.resetAt } : {}),
          ...(runtime.circuitState !== undefined ? { runtimeCircuitState: runtime.circuitState } : {})
        }
      : {})
  };
}

export function internalErrorEvent(
  action: DvarAction,
  decision: DvarDecision
): DvarAuditEvent {
  return {
    type: "dvar.runtime.internal_error",
    timestamp: new Date().toISOString(),
    actionId: action.id,
    decisionId: decision.id,
    principalId: action.principal.id,
    agentId: action.agent.id,
    ...(action.tenant?.id !== undefined ? { tenantId: action.tenant.id } : {}),
    environment: action.environment,
    serverId: action.server.id,
    toolName: action.tool.name,
    capabilities: action.tool.capabilities ?? [],
    actionHash: decision.actionHash,
    effect: decision.effect,
    ...(decision.observedEffect !== undefined ? { observedEffect: decision.observedEffect } : {}),
    ruleId: decision.ruleId,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    policyHash: decision.policyHash,
    risk: decision.risk,
    durationMs: decision.durationMs
  };
}

const INTEGRITY_REASON_CODES = new Set([
  "tool.lockfile_missing",
  "tool.unknown_server",
  "tool.unlocked",
  "tool.schema_changed",
  "tool.output_schema_changed",
  "tool.description_changed",
  "tool.annotations_changed",
  "tool.capability_expanded",
  "tool.manifest_changed",
  "destination.changed"
]);

export function integrityMismatchEvent(
  action: DvarAction,
  decision: DvarDecision
): DvarAuditEvent | undefined {
  if (!INTEGRITY_REASON_CODES.has(decision.reasonCode)) return undefined;
  return {
    ...decisionEvent(action, decision),
    type: "dvar.integrity.mismatch"
  };
}
