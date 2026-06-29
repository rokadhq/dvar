import { DvarError } from "../errors.js";

export class DvarRuntimeStoreError extends DvarError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, "runtime.store_unavailable", options);
  }
}
