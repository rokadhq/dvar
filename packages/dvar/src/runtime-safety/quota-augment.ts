import type { DvarQuotaReservationStore } from "./quota-reservations.js";

declare module "./types.js" {
  interface DvarRuntimeSafetyOptions {
    /** Opt in to atomic quota accounting. Does not replace loop/circuit state. */
    quotaReservations?: DvarQuotaReservationStore;
  }
  interface DvarRuntimeDiagnostics {
    quotaReservations?: {
      kind: string;
      distributed: boolean;
      mode: "atomic";
    };
  }
}
