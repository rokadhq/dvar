import type {
  DvarAction,
  DvarApprovalProviderResult,
  DvarApprovalRequest,
  DvarAuditEvent,
  DvarDecision
} from "../types.js";

function base(
  action: DvarAction
): Omit<DvarAuditEvent, "type" | "timestamp"> {
  return {
    actionId: action.id,
    principalId: action.principal.id,
    agentId: action.agent.id,
    ...(action.tenant?.id !== undefined
      ? { tenantId: action.tenant.id }
      : {}),
    environment: action.environment,
    serverId: action.server.id,
    toolName: action.tool.name,
    capabilities: action.tool.capabilities ?? []
  };
}

export function approvalRequestEvent(
  action: DvarAction,
  request: DvarApprovalRequest
): DvarAuditEvent {
  return {
    ...base(action),
    type: "dvar.approval.requested",
    timestamp: new Date().toISOString(),
    approvalRequestId: request.id,
    approvalScope: request.scope,
    approvalProvider: request.provider,
    policyHash: request.policyHash,
    policyVersion: request.policyVersion,
    ruleId: request.ruleId,
    risk: request.risk
  };
}

export function approvalProviderResultEvent(
  action: DvarAction,
  request: DvarApprovalRequest,
  result: DvarApprovalProviderResult
): DvarAuditEvent {
  return {
    ...base(action),
    type: result.status === "pending"
      ? "dvar.approval.pending"
      : result.status === "approved"
        ? "dvar.action.approved"
        : "dvar.action.rejected",
    timestamp: new Date().toISOString(),
    approvalRequestId: request.id,
    approvalScope: request.scope,
    approvalProvider: request.provider,
    approvalStatus: result.status,
    ...(result.approver?.id !== undefined
      ? { approverId: result.approver.id }
      : {})
  };
}

export function approvalProviderErrorEvent(
  action: DvarAction,
  request: DvarApprovalRequest
): DvarAuditEvent {
  return {
    ...base(action),
    type: "dvar.approval.provider_error",
    timestamp: new Date().toISOString(),
    approvalRequestId: request.id,
    approvalScope: request.scope,
    approvalProvider: request.provider,
    approvalStatus: "provider_error"
  };
}

export function approvalConsumedEvent(
  action: DvarAction,
  decision: DvarDecision
): DvarAuditEvent | undefined {
  if (decision.approval?.status !== "accepted") return undefined;
  return {
    ...base(action),
    type: "dvar.approval.consumed",
    timestamp: new Date().toISOString(),
    decisionId: decision.id,
    actionHash: decision.actionHash,
    ...(decision.approval.requestId !== undefined
      ? { approvalRequestId: decision.approval.requestId }
      : {}),
    ...(decision.approval.grantId !== undefined
      ? { approvalGrantId: decision.approval.grantId }
      : {}),
    ...(decision.approval.scope !== undefined
      ? { approvalScope: decision.approval.scope }
      : {}),
    ...(decision.approval.provider !== undefined
      ? { approvalProvider: decision.approval.provider }
      : {}),
    ...(decision.approval.approverId !== undefined
      ? { approverId: decision.approval.approverId }
      : {}),
    approvalStatus: "accepted"
  };
}

export function approvalReplayEvent(
  action: DvarAction,
  decision: DvarDecision
): DvarAuditEvent | undefined {
  if (decision.reasonCode !== "approval.grant_replayed") return undefined;
  return {
    ...base(action),
    type: "dvar.approval.replay_detected",
    timestamp: new Date().toISOString(),
    decisionId: decision.id,
    actionHash: decision.actionHash,
    ...(decision.approval?.requestId !== undefined
      ? { approvalRequestId: decision.approval.requestId }
      : {}),
    ...(decision.approval?.scope !== undefined
      ? { approvalScope: decision.approval.scope }
      : {}),
    approvalStatus: "invalid",
    reasonCode: decision.reasonCode
  };
}
