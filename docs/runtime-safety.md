# Dvar Runtime Safety

Dvar runtime safety constrains what an agent may do across a sequence of otherwise valid actions. It complements per-action policy and approval rather than replacing them.

## Execution model

`evaluate(action)` is side-effect-free. It does not mutate quota, loop, or circuit state and is suitable for previews, tests, approval requests, and replay.

`authorize(action)` evaluates policy and commits runtime state immediately before execution. `protectTool()` and the MCP proxy use this path automatically.

When circuit breakers are configured, call `recordOutcome(action, outcome)` after manual execution. Protected tools and proxied MCP calls record outcomes automatically.

## Controls

### Call ceilings

- `maxToolCallsPerTask`
- `maxToolCallsPerSession`
- `maxConsecutiveToolCalls`

Task and session ceilings require the corresponding identifiers in the action context. Missing required scope context is denied rather than silently collapsed into a global bucket.

### Depth and retries

`maxDepth` uses `action.trace.depth`. `maxRetries` uses `action.usage.retry`. An intentional zero-retry policy is supported.

### Quotas

Each quota defines:

- a stable ID;
- metric: `calls`, `cost`, or `monetary`;
- positive limit;
- fixed window in seconds;
- one or more scope dimensions;
- optional matcher conditions;
- currency for monetary quotas;
- behavior when required usage is missing.

Scope dimensions include global, principal, agent, tenant, session, task, environment, server, tool, and destination.

Cost and monetary values must be produced by trusted application accounting. They must not be taken directly from model output or untrusted tool arguments.

### Loop detection

Dvar stores bounded semantic action fingerprints. It detects:

- the same action repeated more than the configured threshold;
- alternating A/B action patterns beyond the configured oscillation threshold.

Loop detection is heuristic. Thresholds should be introduced in monitor mode and tuned against normal workloads before enforcement.

### Circuit breakers

Circuit breakers are keyed by configured scope and transition through:

- `closed`: calls are permitted and failures are counted;
- `open`: calls are denied until recovery time;
- `half_open`: a bounded number of probe calls are permitted.

A successful probe closes the breaker. A failed probe reopens it.

Protected function tools record executor success or failure. The MCP proxy currently records HTTP-level upstream success or failure; an application-level JSON-RPC error delivered with HTTP 200 is therefore not counted as a transport failure.

## Stores

### In-memory store

`InMemoryRuntimeStore` is deterministic and atomic inside one Node.js process. It is suitable for tests, development, and a single enforcement instance.

### Redis and Valkey

`createRedisRuntimeStore()` and `createValkeyRuntimeStore()` accept a small client interface exposing `eval` and optionally `ping`. Atomic counters, sequences, and circuit transitions execute as server-side scripts.

The core package does not require a specific Redis client.

## Distributed enforcement

Dvar rejects process-local state when:

- `runtime.requireDistributedStore` is true; or
- `runtimeSafety.deploymentInstances` is greater than one while stateful controls are enabled.

This prevents accidental per-process quotas in horizontally scaled deployments. Correctness still depends on all relevant execution paths using the same shared store and key prefix.

## Store failure

Runtime-store errors fail closed by default.

`runtime.onRuntimeStoreError: allow` explicitly permits fail-open behavior in enforce mode. Strict mode ignores that override and remains fail closed. Monitor mode reports the would-deny result without blocking execution.

## Reservation semantics

Runtime counters are conservative reservations made before execution. When several controls apply, an earlier counter may be consumed even if a later control denies the same action. Dvar does not roll back reservations because distributed rollback can reintroduce race conditions and oversubscription.

Use limits that account for this conservative behavior. Future versions may add grouped atomic reservations for stores capable of multi-control transactions.

## MCP accounting headers

The approval-aware MCP proxy accepts:

```text
X-Dvar-Retry
X-Dvar-Cost
X-Dvar-Monetary-Value
X-Dvar-Currency
```

These values are consumed by Dvar and excluded from the upstream allowlist. Place the proxy behind an authenticated boundary so callers cannot forge principal, tenant, usage, or currency context.

## Approval interaction

Runtime usage participates in the semantic action hash and default approval bindings. Changing reviewed retry, cost, monetary value, or currency invalidates a one-time approval grant.

A valid approval does not bypass runtime safety. The resumed action must still pass quotas, loop detection, depth/retry ceilings, and circuit breakers.

## Audit and diagnostics

Decision events may include bounded metadata:

- control identifier;
- store kind;
- distributed flag;
- current and limit values;
- reset time;
- circuit state.

Raw accounting payloads are not copied into default audit events.

`runtime.diagnostics()` reports enabled stateful controls, store health, deployment assumptions, distributed requirements, and warnings.
