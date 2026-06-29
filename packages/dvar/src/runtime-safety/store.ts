import type {
  DvarCircuitState,
  DvarRuntimeCircuitOutcomeRequest,
  DvarRuntimeCircuitRequest,
  DvarRuntimeCircuitResult,
  DvarRuntimeCounterRequest,
  DvarRuntimeCounterResult,
  DvarRuntimeSequenceRequest,
  DvarRuntimeSequenceResult,
  DvarRuntimeStore,
  DvarRuntimeStoreDiagnostics
} from "./types.js";

interface CounterRecord {
  value: number;
  expiresAtMs: number;
}

interface SequenceRecord {
  values: string[];
  expiresAtMs: number;
}

interface CircuitRecord {
  state: DvarCircuitState;
  failures: number;
  openedAtMs?: number;
  halfOpenCalls: number;
}

export class InMemoryRuntimeStore implements DvarRuntimeStore {
  public readonly kind = "memory";
  public readonly distributed = false;

  private readonly counters = new Map<string, CounterRecord>();
  private readonly sequences = new Map<string, SequenceRecord>();
  private readonly circuits = new Map<string, CircuitRecord>();

  public consumeCounter(
    request: DvarRuntimeCounterRequest
  ): DvarRuntimeCounterResult {
    const existing = this.counters.get(request.key);
    const record = existing === undefined || existing.expiresAtMs <= request.nowMs
      ? { value: 0, expiresAtMs: request.nowMs + request.windowMs }
      : existing;
    const next = record.value + request.amount;
    if (next > request.limit) {
      return {
        allowed: false,
        value: record.value,
        limit: request.limit,
        resetAtMs: record.expiresAtMs
      };
    }
    this.counters.set(request.key, {
      value: next,
      expiresAtMs: record.expiresAtMs
    });
    this.prune(request.nowMs);
    return {
      allowed: true,
      value: next,
      limit: request.limit,
      resetAtMs: record.expiresAtMs
    };
  }

  public appendSequence(
    request: DvarRuntimeSequenceRequest
  ): DvarRuntimeSequenceResult {
    const existing = this.sequences.get(request.key);
    const values = existing === undefined || existing.expiresAtMs <= request.nowMs
      ? []
      : [...existing.values];
    values.push(request.value);
    const bounded = values.slice(-request.maxEntries);
    this.sequences.set(request.key, {
      values: bounded,
      expiresAtMs: request.nowMs + request.ttlMs
    });
    this.prune(request.nowMs);
    return { values: bounded };
  }

  public circuitBefore(
    request: DvarRuntimeCircuitRequest
  ): DvarRuntimeCircuitResult {
    const current = this.circuits.get(request.key) ?? {
      state: "closed" as const,
      failures: 0,
      halfOpenCalls: 0
    };

    if (current.state === "open") {
      const openedAtMs = current.openedAtMs ?? request.nowMs;
      const retryAtMs = openedAtMs + request.recoveryMs;
      if (request.nowMs < retryAtMs) {
        return {
          allowed: false,
          state: "open",
          failures: current.failures,
          retryAtMs
        };
      }
      const halfOpen: CircuitRecord = {
        state: "half_open",
        failures: current.failures,
        halfOpenCalls: 1
      };
      this.circuits.set(request.key, halfOpen);
      return {
        allowed: true,
        state: "half_open",
        failures: halfOpen.failures
      };
    }

    if (current.state === "half_open") {
      if (current.halfOpenCalls >= request.halfOpenMaxCalls) {
        return {
          allowed: false,
          state: "half_open",
          failures: current.failures
        };
      }
      current.halfOpenCalls += 1;
      this.circuits.set(request.key, current);
      return {
        allowed: true,
        state: "half_open",
        failures: current.failures
      };
    }

    return { allowed: true, state: "closed", failures: current.failures };
  }

  public circuitAfter(
    request: DvarRuntimeCircuitOutcomeRequest
  ): DvarRuntimeCircuitResult {
    const current = this.circuits.get(request.key) ?? {
      state: "closed" as const,
      failures: 0,
      halfOpenCalls: 0
    };

    if (request.success) {
      this.circuits.delete(request.key);
      return { allowed: true, state: "closed", failures: 0 };
    }

    const failures = current.failures + 1;
    if (
      current.state === "half_open"
      || current.state === "open"
      || failures >= request.failureThreshold
    ) {
      this.circuits.set(request.key, {
        state: "open",
        failures,
        openedAtMs: request.nowMs,
        halfOpenCalls: 0
      });
      return {
        allowed: false,
        state: "open",
        failures,
        retryAtMs: request.nowMs + request.recoveryMs
      };
    }

    this.circuits.set(request.key, {
      state: "closed",
      failures,
      halfOpenCalls: 0
    });
    return { allowed: true, state: "closed", failures };
  }

  public diagnostics(): DvarRuntimeStoreDiagnostics {
    return {
      kind: this.kind,
      distributed: this.distributed,
      healthy: true,
      checkedAt: new Date().toISOString()
    };
  }

  private prune(nowMs: number): void {
    if (this.counters.size + this.sequences.size < 10_000) return;
    for (const [key, record] of this.counters) {
      if (record.expiresAtMs <= nowMs) this.counters.delete(key);
    }
    for (const [key, record] of this.sequences) {
      if (record.expiresAtMs <= nowMs) this.sequences.delete(key);
    }
  }
}
