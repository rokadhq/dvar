import { performance } from "node:perf_hooks";
import type {
  DvarRedisRuntimeStoreOptions,
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

const COUNTER_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[3]) end
local next = current + tonumber(ARGV[1])
if next > tonumber(ARGV[2]) then
  return {0, tostring(current), tostring(ttl)}
end
redis.call('SET', KEYS[1], tostring(next), 'PX', ttl)
return {1, tostring(next), tostring(ttl)}
`;

const SEQUENCE_SCRIPT = `
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], -tonumber(ARGV[2]), -1)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return redis.call('LRANGE', KEYS[1], 0, -1)
`;

const CIRCUIT_BEFORE_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures') or '0')
local openedAt = tonumber(redis.call('HGET', KEYS[1], 'openedAt') or '0')
local halfOpenCalls = tonumber(redis.call('HGET', KEYS[1], 'halfOpenCalls') or '0')
local now = tonumber(ARGV[1])
local recovery = tonumber(ARGV[2])
local halfOpenMax = tonumber(ARGV[3])
if state == 'open' then
  local retryAt = openedAt + recovery
  if now < retryAt then return {0, state, failures, retryAt} end
  state = 'half_open'
  halfOpenCalls = 0
end
if state == 'half_open' then
  if halfOpenCalls >= halfOpenMax then return {0, state, failures, 0} end
  halfOpenCalls = halfOpenCalls + 1
  redis.call('HSET', KEYS[1], 'state', state, 'failures', failures, 'halfOpenCalls', halfOpenCalls)
  redis.call('PEXPIRE', KEYS[1], recovery * 2)
  return {1, state, failures, 0}
end
return {1, 'closed', failures, 0}
`;

const CIRCUIT_AFTER_SCRIPT = `
local success = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])
local recovery = tonumber(ARGV[4])
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures') or '0')
if success == 1 then
  redis.call('DEL', KEYS[1])
  return {1, 'closed', 0, 0}
end
failures = failures + 1
if state == 'half_open' or state == 'open' or failures >= threshold then
  redis.call('HSET', KEYS[1], 'state', 'open', 'failures', failures, 'openedAt', now, 'halfOpenCalls', 0)
  redis.call('PEXPIRE', KEYS[1], recovery * 2)
  return {0, 'open', failures, now + recovery}
end
redis.call('HSET', KEYS[1], 'state', 'closed', 'failures', failures, 'halfOpenCalls', 0)
redis.call('PEXPIRE', KEYS[1], recovery * 2)
return {1, 'closed', failures, 0}
`;

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Runtime store returned a non-array reply");
  return value;
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Runtime store returned an invalid number");
  return parsed;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

export function createRedisRuntimeStore(
  options: DvarRedisRuntimeStoreOptions
): DvarRuntimeStore {
  const kind = options.kind ?? "redis";
  return {
    kind,
    distributed: true,

    async consumeCounter(
      request: DvarRuntimeCounterRequest
    ): Promise<DvarRuntimeCounterResult> {
      const reply = array(await options.client.eval(COUNTER_SCRIPT, {
        keys: [request.key],
        arguments: [
          String(request.amount),
          String(request.limit),
          String(request.windowMs)
        ]
      }));
      const ttlMs = numeric(reply[2]);
      return {
        allowed: numeric(reply[0]) === 1,
        value: numeric(reply[1]),
        limit: request.limit,
        resetAtMs: request.nowMs + Math.max(ttlMs, 0)
      };
    },

    async appendSequence(
      request: DvarRuntimeSequenceRequest
    ): Promise<DvarRuntimeSequenceResult> {
      const reply = array(await options.client.eval(SEQUENCE_SCRIPT, {
        keys: [request.key],
        arguments: [request.value, String(request.maxEntries), String(request.ttlMs)]
      }));
      return { values: reply.map(text) };
    },

    async circuitBefore(
      request: DvarRuntimeCircuitRequest
    ): Promise<DvarRuntimeCircuitResult> {
      const reply = array(await options.client.eval(CIRCUIT_BEFORE_SCRIPT, {
        keys: [request.key],
        arguments: [
          String(request.nowMs),
          String(request.recoveryMs),
          String(request.halfOpenMaxCalls)
        ]
      }));
      const retryAtMs = numeric(reply[3]);
      return {
        allowed: numeric(reply[0]) === 1,
        state: text(reply[1]) as DvarRuntimeCircuitResult["state"],
        failures: numeric(reply[2]),
        ...(retryAtMs > 0 ? { retryAtMs } : {})
      };
    },

    async circuitAfter(
      request: DvarRuntimeCircuitOutcomeRequest
    ): Promise<DvarRuntimeCircuitResult> {
      const reply = array(await options.client.eval(CIRCUIT_AFTER_SCRIPT, {
        keys: [request.key],
        arguments: [
          request.success ? "1" : "0",
          String(request.nowMs),
          String(request.failureThreshold),
          String(request.recoveryMs)
        ]
      }));
      const retryAtMs = numeric(reply[3]);
      return {
        allowed: numeric(reply[0]) === 1,
        state: text(reply[1]) as DvarRuntimeCircuitResult["state"],
        failures: numeric(reply[2]),
        ...(retryAtMs > 0 ? { retryAtMs } : {})
      };
    },

    async diagnostics(): Promise<DvarRuntimeStoreDiagnostics> {
      const startedAt = performance.now();
      try {
        if (options.client.ping !== undefined) await options.client.ping();
        else {
          await options.client.eval("return 'PONG'", {
            keys: [],
            arguments: []
          });
        }
        return {
          kind,
          distributed: true,
          healthy: true,
          checkedAt: new Date().toISOString(),
          latencyMs: performance.now() - startedAt
        };
      } catch (error) {
        return {
          kind,
          distributed: true,
          healthy: false,
          checkedAt: new Date().toISOString(),
          latencyMs: performance.now() - startedAt,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

export function createValkeyRuntimeStore(
  options: Omit<DvarRedisRuntimeStoreOptions, "kind">
): DvarRuntimeStore {
  return createRedisRuntimeStore({ ...options, kind: "valkey" });
}
