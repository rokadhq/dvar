import { DvarError } from "../errors.js";
import type {
  DvarApprovalProviderResult,
  DvarApprovalRequest,
  DvarDecision
} from "../types.js";

export class DvarApprovalRejectedError extends DvarError {
  public constructor(
    public readonly decision: DvarDecision,
    public readonly request: DvarApprovalRequest,
    public readonly providerResult: DvarApprovalProviderResult
  ) {
    super(
      providerResult.reason ?? "Approval request was rejected",
      "approval.rejected"
    );
  }
}

export class DvarApprovalProviderError extends DvarError {
  public constructor(
    public readonly request: DvarApprovalRequest,
    cause: unknown
  ) {
    super(
      cause instanceof Error ? cause.message : "Approval provider failed",
      cause instanceof DvarError
        ? cause.code
        : "approval.provider_unavailable",
      cause instanceof Error ? { cause } : undefined
    );
  }
}
