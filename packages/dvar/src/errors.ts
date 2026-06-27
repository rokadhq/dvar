import type { DvarDecision } from "./types.js";

export class DvarError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class DvarConfigurationError extends DvarError {
  public readonly diagnostics: string[];

  public constructor(message: string, diagnostics: string[] = [], options?: ErrorOptions) {
    super(message, "configuration.invalid", options);
    this.diagnostics = diagnostics;
  }
}

export class DvarDeniedError extends DvarError {
  public readonly decision: DvarDecision;

  public constructor(decision: DvarDecision) {
    super(decision.message, decision.reasonCode);
    this.decision = decision;
  }
}

export class DvarApprovalRequiredError extends DvarError {
  public readonly decision: DvarDecision;

  public constructor(decision: DvarDecision) {
    super(decision.message, decision.reasonCode);
    this.decision = decision;
  }
}
