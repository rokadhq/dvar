import { createHash } from "node:crypto";

/** Accounting uses integer millionths. Values with more than six decimals fail closed. */
export const DVAR_QUOTA_SCALE = 1_000_000;
const MAX_UNITS = Number.MAX_SAFE_INTEGER;
const MAX_WINDOW_MS = 2_592_000_000;

export interface DvarQuotaCounter {
  key: string;
  amount: number;
  limit: number;
  windowMs: number;
}

export interface DvarQuotaReservationRequest {
  /** Stable for retries of ONE authorization attempt, not reusable execution authority. */
  requestId: string;
  /** Trusted semantic action/policy binding, excluding timestamps and telemetry. */
  binding: string;
  counters: readonly DvarQuotaCounter[];
}

export interface DvarQuotaSnapshot {
  value: number;
  limit: number;
  resetAtMs: number;
}

export interface DvarQuotaReservationResult {
  status: "reserved" | "denied" | "replayed" | "conflict";
  counters: DvarQuotaSnapshot[];
  deniedIndex?: number;
  /** A replay is a receipt lookup, NEVER permission to execute again. */
  originalStatus?: "reserved" | "denied";
}

export interface DvarQuotaReservationStore {
  readonly kind: string;
  readonly distributed: boolean;
  reserve(request: DvarQuotaReservationRequest): DvarQuotaReservationResult | Promise<DvarQuotaReservationResult>;
}

export interface DvarQuotaStoreOptions {
  /** Fixed trusted partition. All cross-process participants must use the same namespace. */
  namespace: string;
  maxCounters?: number;
  maxReceipts?: number;
  receiptTtlMs?: number;
}

export interface DvarMemoryQuotaStoreOptions extends DvarQuotaStoreOptions {
  clock?: () => number;
}

export class DvarQuotaStoreError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "DvarQuotaStoreError";
  }
}

export interface QuotaLimits {
  maxCounters: number;
  maxReceipts: number;
  receiptTtlMs: number;
}
export interface PreparedCounter { key: string; amount: number; limit: number; windowMs: number }
export interface PreparedReservation { id: string; fingerprint: string; counters: PreparedCounter[] }
interface StoredCounter { units: number; expiresAt: number }
interface StoredReceipt {
  fingerprint: string;
  expiresAt: number;
  result: DvarQuotaReservationResult;
}
interface QuotaState {
  counters: Map<string, StoredCounter>;
  receipts: Map<string, StoredReceipt>;
}

export function quotaHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 4096) {
    throw new DvarQuotaStoreError("runtime.quota_identifier_invalid");
  }
}

export function quotaLimits(options: DvarQuotaStoreOptions): QuotaLimits {
  identifier(options.namespace);
  const maxCounters = options.maxCounters ?? 2048;
  const maxReceipts = options.maxReceipts ?? 4096;
  const receiptTtlMs = options.receiptTtlMs ?? 60_000;
  for (const [value, maximum] of [[maxCounters, 8192], [maxReceipts, 16384], [receiptTtlMs, 86_400_000]]) {
    if (!Number.isSafeInteger(value) || value! < 1 || value! > maximum!) {
      throw new DvarQuotaStoreError("runtime.quota_options_invalid");
    }
  }
  return { maxCounters, maxReceipts, receiptTtlMs };
}

/** Decimal-string conversion avoids silently rounding financial usage down. */
function units(value: number, positive: boolean): number {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new DvarQuotaStoreError("runtime.quota_amount_invalid");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/u.exec(String(value));
  if (match === null) throw new DvarQuotaStoreError("runtime.quota_amount_invalid");
  const fraction = match[2] ?? "";
  const exponent = 6 + Number(match[3] ?? "0") - fraction.length;
  let result = BigInt(`${match[1]}${fraction}`);
  if (exponent >= 0) result *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    if (result % divisor !== 0n) throw new DvarQuotaStoreError("runtime.quota_precision_exceeded");
    result /= divisor;
  }
  if (result > BigInt(MAX_UNITS)) throw new DvarQuotaStoreError("runtime.quota_amount_invalid");
  return Number(result);
}

export function prepareReservation(request: DvarQuotaReservationRequest): PreparedReservation {
  if (request === null || typeof request !== "object") throw new DvarQuotaStoreError("runtime.quota_batch_invalid");
  identifier(request.requestId);
  identifier(request.binding);
  if (!Array.isArray(request.counters) || request.counters.length < 1 || request.counters.length > 130) {
    throw new DvarQuotaStoreError("runtime.quota_batch_invalid");
  }
  const seen = new Set<string>();
  const counters = request.counters.map((counter) => {
    if (counter === null || typeof counter !== "object") throw new DvarQuotaStoreError("runtime.quota_batch_invalid");
    identifier(counter.key);
    if (seen.has(counter.key)) throw new DvarQuotaStoreError("runtime.quota_duplicate_counter");
    seen.add(counter.key);
    if (!Number.isSafeInteger(counter.windowMs) || counter.windowMs < 1 || counter.windowMs > MAX_WINDOW_MS) {
      throw new DvarQuotaStoreError("runtime.quota_window_invalid");
    }
    return {
      key: quotaHash(counter.key),
      amount: units(counter.amount, false),
      limit: units(counter.limit, true),
      windowMs: counter.windowMs
    };
  });
  // Array order participates deliberately: deniedIndex is relative to this order.
  return {
    id: quotaHash(request.requestId),
    fingerprint: quotaHash(JSON.stringify([request.binding, counters])),
    counters
  };
}

function cloneResult(result: DvarQuotaReservationResult): DvarQuotaReservationResult {
  return { ...result, counters: result.counters.map((counter) => ({ ...counter })) };
}

/** One fixed partition, bounded by live counter/receipt counts. No eviction of live authority. */
export function createInMemoryQuotaReservationStore(
  options: DvarMemoryQuotaStoreOptions
): DvarQuotaReservationStore {
  const limits = quotaLimits(options);
  const clock = options.clock ?? Date.now;
  let lastNow = -1;
  let state: QuotaState = { counters: new Map(), receipts: new Map() };
  return {
    kind: "memory-quota-v1",
    distributed: false,
    reserve(request) {
      const prepared = prepareReservation(request);
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - MAX_WINDOW_MS) {
        throw new DvarQuotaStoreError("runtime.quota_clock_invalid");
      }
      if (now < lastNow) throw new DvarQuotaStoreError("runtime.quota_clock_regressed");
      // All validation and capacity checks happen against a copy before the single commit.
      const next: QuotaState = {
        counters: new Map([...state.counters].filter(([, entry]) => entry.expiresAt > now)),
        receipts: new Map([...state.receipts].filter(([, entry]) => entry.expiresAt > now))
      };
      const receipt = next.receipts.get(prepared.id);
      if (receipt !== undefined) {
        if (receipt.fingerprint !== prepared.fingerprint) return { status: "conflict", counters: [] };
        return { ...cloneResult(receipt.result), status: "replayed", originalStatus: receipt.result.status as "reserved" | "denied" };
      }
      if (next.receipts.size >= limits.maxReceipts) throw new DvarQuotaStoreError("runtime.quota_capacity_exceeded");
      const snapshots: DvarQuotaSnapshot[] = [];
      const pending: Array<[string, StoredCounter]> = [];
      let deniedIndex: number | undefined;
      for (const [index, counter] of prepared.counters.entries()) {
        const current = next.counters.get(counter.key) ?? { units: 0, expiresAt: now + counter.windowMs };
        if (counter.amount > counter.limit - current.units && deniedIndex === undefined) deniedIndex = index;
        snapshots.push({ value: current.units / DVAR_QUOTA_SCALE, limit: counter.limit / DVAR_QUOTA_SCALE, resetAtMs: current.expiresAt });
        // A denied request never commits pending data, including overflowing intermediate sums.
        pending.push([counter.key, { units: current.units + counter.amount, expiresAt: current.expiresAt }]);
      }
      if (deniedIndex === undefined) {
        const additions = pending.filter(([key]) => !next.counters.has(key)).length;
        if (next.counters.size + additions > limits.maxCounters) throw new DvarQuotaStoreError("runtime.quota_capacity_exceeded");
        pending.forEach(([key, counter], index) => {
          next.counters.set(key, counter);
          snapshots[index]!.value = counter.units / DVAR_QUOTA_SCALE;
        });
      }
      const result: DvarQuotaReservationResult = {
        status: deniedIndex === undefined ? "reserved" : "denied",
        counters: snapshots,
        ...(deniedIndex === undefined ? {} : { deniedIndex })
      };
      next.receipts.set(prepared.id, { fingerprint: prepared.fingerprint, expiresAt: now + limits.receiptTtlMs, result: cloneResult(result) });
      state = next;
      lastNow = now;
      return result;
    }
  };
}
