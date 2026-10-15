import {
  DvarQuotaStoreError,
  prepareReservation,
  quotaHash,
  quotaLimits,
  type DvarQuotaReservationResult,
  type DvarQuotaReservationStore,
  type DvarQuotaStoreOptions,
  type PreparedCounter
} from "./quota-reservations.js";

export interface DvarQuotaRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
export interface DvarRedisQuotaStoreOptions extends DvarQuotaStoreOptions {
  client: DvarQuotaRedisClient;
  /** A timeout has an unknown commit outcome; retry only the same request ID. */
  timeoutMs?: number;
}

// One partition / one Redis key / one final SET. Redis Lua is isolated, but is NOT
// a rollback transaction: multiple sequential writes could survive a later error.
// The final SET commits budgets, expiries and the idempotency receipt together.
export const DVAR_QUOTA_RESERVATION_SCRIPT = `
local MAX = 9007199254740991
local MAX_BYTES = 4194304
local function fail(code) return redis.error_reply('DVAR_QUOTA:' .. code) end
local function integer(n, min, max)
  return type(n) == 'number' and n == math.floor(n) and n >= min and n <= max
end
local raw = redis.call('GET', KEYS[1])
if raw and string.len(raw) > MAX_BYTES then return fail('state_too_large') end
local state = { version = 1, lastNow = 0, counters = {}, receipts = {} }
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= 'table' or decoded.version ~= 1 or
    type(decoded.counters) ~= 'table' or type(decoded.receipts) ~= 'table' then
    return fail('state_invalid')
  end
  state = decoded
end
local args = cjson.decode(ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if not integer(state.lastNow, 0, MAX) or now < state.lastNow then return fail('clock_invalid') end
local counterCount = 0
local receiptCount = 0
local expiresAt = now + args.receiptTtlMs
for key, entry in pairs(state.counters) do
  if type(entry) ~= 'table' or type(entry.units) ~= 'string' or not integer(tonumber(entry.units), 0, MAX) or
    not integer(entry.expiresAt, 0, MAX) then return fail('state_invalid') end
  if entry.expiresAt <= now then state.counters[key] = nil
  else
    counterCount = counterCount + 1
    expiresAt = math.max(expiresAt, entry.expiresAt)
  end
end
for key, entry in pairs(state.receipts) do
  if type(entry) ~= 'table' or not integer(entry.expiresAt, 0, MAX) or
    type(entry.fingerprint) ~= 'string' or type(entry.result) ~= 'table' or
    (entry.result.status ~= 'reserved' and entry.result.status ~= 'denied') or
    type(entry.result.counters) ~= 'table' then return fail('state_invalid') end
  if entry.expiresAt <= now then state.receipts[key] = nil
  else
    receiptCount = receiptCount + 1
    expiresAt = math.max(expiresAt, entry.expiresAt)
  end
end
local receipt = state.receipts[args.id]
if receipt then
  if receipt.fingerprint ~= args.fingerprint then return cjson.encode({ status = 'conflict' }) end
  local result = receipt.result
  result.originalStatus = result.status
  result.status = 'replayed'
  return cjson.encode(result)
end
if receiptCount >= args.maxReceipts or counterCount > args.maxCounters then
  return fail('capacity_exceeded')
end
local snapshots = {}
local pending = {}
local deniedIndex = nil
local additions = 0
for index, counter in ipairs(args.counters) do
  local current = state.counters[counter.key]
  if not current then
    current = { units = '0', expiresAt = now + counter.windowMs }
    additions = additions + 1
  end
  if counter.amount > counter.limit - tonumber(current.units) and deniedIndex == nil then deniedIndex = index - 1 end
  snapshots[index] = { value = string.format('%.17g', tonumber(current.units) / 1000000), limit = string.format('%.17g', counter.limit / 1000000), resetAtMs = current.expiresAt }
  pending[index] = { units = string.format('%.0f', tonumber(current.units) + counter.amount), expiresAt = current.expiresAt }
end
local result = { status = 'denied', counters = snapshots, deniedIndex = deniedIndex }
if deniedIndex == nil then
  if counterCount + additions > args.maxCounters then return fail('capacity_exceeded') end
  result.status = 'reserved'
  for index, counter in ipairs(args.counters) do
    state.counters[counter.key] = pending[index]
    snapshots[index].value = string.format('%.17g', tonumber(pending[index].units) / 1000000)
    expiresAt = math.max(expiresAt, pending[index].expiresAt)
  end
end
state.receipts[args.id] = {
  fingerprint = args.fingerprint, expiresAt = now + args.receiptTtlMs, result = result
}
state.lastNow = now
local encoded = cjson.encode(state)
if string.len(encoded) > MAX_BYTES then return fail('state_too_large') end
redis.call('SET', KEYS[1], encoded, 'PX', expiresAt - now)
return cjson.encode(result)
`;

function decodeReply(reply: unknown, expected: PreparedCounter[]): DvarQuotaReservationResult {
  const count = expected.length;
  try {
    if (typeof reply !== "string" || Buffer.byteLength(reply) > 131072) throw new Error();
    const result = JSON.parse(reply) as DvarQuotaReservationResult;
    if (result.status === "conflict") return { status: "conflict", counters: [] };
    if (!["reserved", "denied", "replayed"].includes(result.status) ||
      !Array.isArray(result.counters) || result.counters.length !== count) throw new Error();
    const original = result.status === "replayed" ? result.originalStatus : result.status;
    if (original !== "reserved" && original !== "denied") throw new Error();
    if (original === "denied" && (!Number.isInteger(result.deniedIndex) || result.deniedIndex! < 0 || result.deniedIndex! >= count)) throw new Error();
    if (original === "reserved" && result.deniedIndex !== undefined) throw new Error();
    for (const [index, counter] of result.counters.entries()) {
      if (typeof counter.value !== "string" || typeof counter.limit !== "string" || !/^\d/.test(counter.value) || !/^\d/.test(counter.limit)) throw new Error();
      counter.value = Number(counter.value);
      counter.limit = Number(counter.limit);
      if (!Number.isFinite(counter.value) || counter.value < 0 ||
        !Number.isFinite(counter.limit) || counter.limit <= 0 ||
        !Number.isSafeInteger(counter.resetAtMs) || counter.resetAtMs < 0 || counter.resetAtMs > 8_640_000_000_000_000 || counter.limit !== expected[index]!.limit / 1_000_000 || (original === "reserved" && counter.value > counter.limit)) throw new Error();
    }
    return {
      status: result.status,
      counters: result.counters.map(({ value, limit, resetAtMs }) => ({ value, limit, resetAtMs })),
      ...(result.deniedIndex === undefined ? {} : { deniedIndex: result.deniedIndex }),
      ...(result.status === "replayed" ? { originalStatus: original } : {})
    };
  } catch {
    throw new DvarQuotaStoreError("runtime.quota_reply_invalid");
  }
}

export function createRedisQuotaReservationStore(options: DvarRedisQuotaStoreOptions): DvarQuotaReservationStore {
  const limits = quotaLimits(options);
  if (typeof options.client?.eval !== "function") throw new DvarQuotaStoreError("runtime.quota_client_invalid");
  const client = options.client;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new DvarQuotaStoreError("runtime.quota_options_invalid");
  const key = `dvar:quota:v1:{${quotaHash(options.namespace)}}`;
  return {
    kind: "redis-quota-v1",
    distributed: true,
    async reserve(request) {
      const prepared = prepareReservation(request);
      let reply: unknown;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const operation = client.eval(DVAR_QUOTA_RESERVATION_SCRIPT, {
          keys: [key],
          arguments: [JSON.stringify({ ...limits, ...prepared })]
        });
        reply = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        })]);
      } catch {
        // Do not expose client URLs, credentials, payloads, or raw store errors.
        // A lost reply may follow a successful commit; never retry with a new ID.
        throw new DvarQuotaStoreError("runtime.quota_store_unavailable");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      return decodeReply(reply, prepared.counters);
    }
  };
}

export function createValkeyQuotaReservationStore(options: DvarRedisQuotaStoreOptions): DvarQuotaReservationStore {
  return { ...createRedisQuotaReservationStore(options), kind: "valkey-quota-v1" };
}
