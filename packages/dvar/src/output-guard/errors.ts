import { DvarError } from "../errors.js";
import type { DvarOutputGuardSummary } from "./types.js";

export class DvarOutputPolicyError extends DvarError {
  public readonly summary: DvarOutputGuardSummary;

  public constructor(summary: DvarOutputGuardSummary, options?: ErrorOptions) {
    super(summary.message ?? "Tool output blocked by Dvar output policy", summary.reasonCode ?? "output.denied", options);
    this.summary = summary;
  }
}
