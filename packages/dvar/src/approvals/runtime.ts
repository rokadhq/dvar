import type {
  DvarAction,
  DvarApprovalProviderResult,
  DvarApprovalRequest,
  DvarApprovalRuntimeOptions,
  DvarApprovalUseStore,
  DvarDecision,
  DvarPolicy
} from "../types.js";
import {
  createApprovalRequest,
  DvarApprovalRequestError
} from "./request.js";
import {
  DvarApprovalGrantError,
  verifyAndConsumeApprovalGrant
} from "./grant.js";
import { InMemoryApprovalUseStore } from "./store.js";

export interface DvarApprovalProcessingOptions {
  policy: DvarPolicy;
  action: DvarAction;
  decision: DvarDecision;
  runtime?: DvarApprovalRuntimeOptions;
  approvalGrant?: string;
  useStore?: DvarApprovalUseStore;
}

function requiresApproval(decision: DvarDecision): boolean {
  return decision.effect === "require_approval"
    || decision.observedEffect === "would_require_approval";
}

function denied(
  decision: DvarDecision,
  reasonCode: string,
  message: string,
  request?: DvarApprovalRequest,
  reason?: string
): DvarDecision {
  return {
    ...decision,
    effect: decision.mode === "monitor" ? "allow" : "deny",
    ...(decision.mode === "monitor"
      ? { observedEffect: "would_deny" as const }
      : {}),
    ruleId: "system.approval",
    reasonCode,
    message,
    ...(request !== undefined ? { approvalRequest: request } : {}),
    approval: {
      status: "invalid",
      ...(request !== undefined
        ? { requestId: request.id, scope: request.scope }
        : {}),
      ...(reason !== undefined ? { reason } : {})
    }
  };
}

export async function processApprovalDecision(
  options: DvarApprovalProcessingOptions
): Promise<DvarDecision> {
  const { policy, action } = options;
  let { decision } = options;
  if (!requiresApproval(decision)) return decision;

  let request: DvarApprovalRequest;
  try {
    request = createApprovalRequest(policy, action, decision, {
      ...(options.runtime?.provider?.name !== undefined
        ? { provider: options.runtime.provider.name }
        : {})
    });
  } catch (error) {
    const reasonCode = error instanceof DvarApprovalRequestError
      ? error.code
      : "approval.request_invalid";
    return denied(
      decision,
      reasonCode,
      error instanceof Error ? error.message : String(error)
    );
  }

  decision = {
    ...decision,
    approvalRequest: request,
    approval: {
      status: "required",
      requestId: request.id,
      scope: request.scope,
      provider: request.provider
    }
  };

  if (decision.mode === "monitor" || options.approvalGrant === undefined) {
    return decision;
  }
  if (options.runtime === undefined) {
    return denied(
      decision,
      "approval.verifier_unavailable",
      "A signed approval grant was supplied but no approval verifier is configured",
      request
    );
  }

  try {
    const claims = await verifyAndConsumeApprovalGrant({
      action,
      request,
      token: options.approvalGrant,
      signer: options.runtime.signer,
      useStore: options.runtime.useStore
        ?? options.useStore
        ?? new InMemoryApprovalUseStore()
    });
    const { observedEffect: _observedEffect, ...baseDecision } = decision;
    return {
      ...baseDecision,
      effect: "allow",
      reasonCode: "approval.grant_accepted",
      message: `Action approved by ${claims.approver.id}`,
      approval: {
        status: "accepted",
        requestId: claims.requestId,
        grantId: claims.id,
        scope: claims.scope,
        approverId: claims.approver.id,
        provider: request.provider
      }
    };
  } catch (error) {
    const reasonCode = error instanceof DvarApprovalGrantError
      ? error.code
      : "approval.grant_invalid";
    return denied(
      decision,
      reasonCode,
      error instanceof Error ? error.message : String(error),
      request,
      reasonCode
    );
  }
}

export async function submitApprovalRequest(
  request: DvarApprovalRequest,
  runtime: DvarApprovalRuntimeOptions | undefined
): Promise<DvarApprovalProviderResult> {
  if (runtime?.provider === undefined) {
    return {
      status: "pending",
      requestId: request.id,
      reason: "No approval provider is configured"
    };
  }
  if (
    request.provider !== "manual"
    && request.provider !== runtime.provider.name
  ) {
    throw new DvarApprovalGrantError(
      `Approval policy requested provider ${request.provider}, but runtime configured ${runtime.provider.name}`,
      "approval.provider_mismatch"
    );
  }
  return runtime.provider.request(request);
}
