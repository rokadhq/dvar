# Atomic quota reservations (v1 development)

This opt-in path implements **F55, slice 02**, not the complete distributed-enforcement milestone. No package release is authorized. The default v0.7 runtime path remains unchanged until an explicit migration.

## Configure the runtime

```ts
import { createDvar } from '@rokadhq/dvar';
import { createInMemoryQuotaReservationStore } from '@rokadhq/dvar/runtime-safety';

// Create and reuse the store; constructing it per call would discard accounting.
const quotaReservations = createInMemoryQuotaReservationStore({ namespace: 'billing-development' });
const dvar = await createDvar({
  policy: {
    schemaVersion: '1', mode: 'strict', defaultEffect: 'allow',
    runtime: {
      maxToolCallsPerTask: 20,
      maxToolCallsPerSession: 100,
      quotas: [{
        id: 'tenant-spend', metric: 'monetary', limit: 5000,
        currency: 'INR', windowSeconds: 86400, scope: ['tenant']
      }]
    }
  },
  runtimeSafety: { quotaReservations }
});
```

With `quotaReservations` configured, task/session call limits and all applicable call/cost/monetary quotas are prepared and reserved as one group. Missing identity, missing/invalid accounting, currency mismatches and unsupported precision are rejected before reservation. A later quota denial does not charge an earlier budget.

Without this option the existing sequential-counter behavior is retained. There is **no sequential fallback** after a configured atomic store fails. The normal `onRuntimeStoreError` policy still applies: strict mode fails closed; explicit fail-open in enforce mode is an availability choice that forfeits quota enforcement for that action. Monitor mode is non-blocking, including for replay denials; it is not an execution guarantee.

## Shared Redis or Valkey storage

```ts
import { createRedisRuntimeStore, createRedisQuotaReservationStore } from '@rokadhq/dvar/runtime-safety';

const runtimeSafety = {
  deploymentInstances: 4,
  store: createRedisRuntimeStore({ client: redis }), // Separate loop/circuit state.
  quotaReservations: createRedisQuotaReservationStore({
    client: redis,
    namespace: 'billing-production',
    maxCounters: 2048,
    maxReceipts: 4096,
    receiptTtlMs: 60000,
    timeoutMs: 5000
  })
};
```

`createValkeyQuotaReservationStore()` exposes the same minimal `eval` client contract. This adapter adds no mandatory Redis client dependency. Redis/Valkey must return the script's UTF-8 JSON string, not a Buffer.

All participants sharing budgets must use the same server, namespace, policy conventions and `keyPrefix`. Different namespaces intentionally isolate state. The namespace is hashed; raw identities, action arguments, approval grants and logical counter names are not stored in the Redis key or receipt binding.

A shared reservation store is mandatory when distributed quota enforcement is declared. Loop histories and circuit breakers still use the separate runtime store, and need their own shared backend in multi-instance deployments. Diagnostics expose that base store separately from `quotaReservations`.

## Atomicity and retry semantics

The Redis implementation keeps one **bounded partition document in one key**, with a hash tag for Cluster routing. A Lua script reads and validates the document, checks every budget, and performs one final `SET ... PX`. Counter changes and the receipt are committed together. This avoids pretending that several Lua writes would automatically roll back if a later command failed.

`reserve({ requestId, binding, counters })` returns:

| Status | Meaning |
| --- | --- |
| `reserved` | This request newly reserved all its budgets. |
| `denied` | At least one budget rejected; no budget was consumed. |
| `replayed` | The receipt for the same request was found. `originalStatus` identifies its previous result. **This is not another execution permit.** |
| `conflict` | The request ID was reused with a changed action binding or counter plan. Nothing was charged. |

The runtime denies `replayed` and `conflict` in enforce/strict mode. `evaluate()` remains a preview and does not reserve. Each new execution attempt needs a unique action ID. Built-in task/session counters also include principal, agent, environment and tenant where present, so a shared task name does not combine tenants accidentally. Explicit quota scopes continue to control intentional global sharing.

A timeout or connection failure can occur **after** the server committed. Dvar does not automatically retry and cannot promise rollback. Retrying the identical ID and binding retrieves the same receipt without another charge, while the receipt exists. Never turn that lookup into a second tool execution. Exactly-once external side effects still require application/tool idempotency and durable execution ownership; neither is supplied by this slice.

Receipts expire after a fixed bounded retention period. Replays do not extend that period. Deduplication is not promised after receipt expiry, Redis eviction, data loss or restored older snapshots.

## Numeric, time and resource limits

Accounting uses integer millionths. Amounts and limits must be nonnegative/positive finite values representable with at most six decimal places and within JavaScript's safe-integer range after scaling. Excess precision is rejected, not rounded down. Provide trusted usage in a consistent currency/unit; this does not implement currency conversion or financial settlement.

Counters have fixed windows starting at their first reservation, not sliding windows or calendar-day resets. Redis `TIME` supplies time for all clients. Backward time relative to the last committed partition update fails closed; this is not protection against arbitrary server clock manipulation. Memory stores accept a test clock and reject backward committed time too.

A batch contains at most 130 distinct counters: up to 128 quotas plus task and session limits. Live counters and receipts are capacity-bounded; live entries are never silently evicted to admit more work. Redis additionally limits the serialized partition to 4 MiB. Only expired records are pruned. The partition's TTL covers its latest counter or receipt expiry.

## Deployment and migration constraints

- One partition key is deliberately a serialization point. Benchmark its CPU, memory and contention before increasing capacity. Horizontal throughput/sharding is not qualified here. Quotas that overlap across tenants must remain in the same partition; splitting them would weaken the guarantee.
- Use dedicated, authenticated Redis/Valkey with an appropriate no-eviction policy, persistence and failover configuration. Asynchronous replication and failover can lose acknowledged state. This slice does not establish cross-region strong consistency.
- Atomic quotas use a new namespace and storage format, **not** existing legacy counter keys. Do not run mixed legacy/atomic enforcers for the same budgets. Drain outstanding work and coordinate a window-boundary cutover or a reviewed state migration. Enabling the option alone does not migrate usage.
- Quota counters are grouped. Circuit probes, loop histories and approval-use stores are not part of this transaction. Crash/lease recovery, grouped multi-control admission and distributed approval replay protection remain F55 work.
- Policy/identity correctness, wrapping every execution boundary, OS permissions and secret isolation remain application responsibilities.

## Tests and qualification

`npm run test:quota` runs the source-shared regression cases against the built runtime-safety export after a build. Runtime-level cases are in `test/quota-runtime.test.ts` and join the normal Vitest suite.

For a disposable local Redis or Valkey server:

```bash
DVAR_QUOTA_REDIS_URL=redis://127.0.0.1:6379 npm run test:quota:live
```

The live target fails when no server is configured; it does not silently skip. It covers concurrent clients, an injected lost reply after a real commit, exact decimal round trips, corrupt state and server-time expiry. Run it against each backend separately. Full server/version matrices, failover, partitions, crashes, reconnects and independent review are still required before F55 is verified.

### Primary design references

- Redis Lua isolation and script key rules: https://redis.io/docs/latest/develop/programmability/eval-intro/
- Redis Cluster hash tags and consistency limits: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
