import { DvarError } from "../errors.js";
import type { DvarStdioPolicyFailure } from "./types.js";

export class DvarStdioPolicyError extends DvarError {
  public readonly failure: DvarStdioPolicyFailure;

  public constructor(failure: DvarStdioPolicyFailure, options?: ErrorOptions) {
    super(failure.message, failure.reasonCode, options);
    this.failure = failure;
  }
}
