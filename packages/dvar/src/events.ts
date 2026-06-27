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
    durationMs: decision.durationMs
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
