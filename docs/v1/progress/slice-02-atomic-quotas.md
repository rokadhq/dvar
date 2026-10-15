# Slice 02 — Atomic quota admission

**Status: development only; F55 in progress. No merge/publication authorization.**

This slice stacks on the v1 foundation (PR #8). CI startup investigation is deliberately deferred at the owner's request.

## Implemented

- Opt-in `runtimeSafety.quotaReservations` with the existing runtime guard, without changing the default legacy counter path.
- Grouped task/session/call/cost/monetary quota admission, with validation before any reservation and no sequential fallback after atomic-store failure.
- In-memory reservation engine and Redis/Valkey adapters using one partition key and one final atomic write.
- Action/policy-bound, fixed-retention idempotency receipts. Replays and conflicts deny further execution in enforce/strict mode; they do not consume budgets again while the receipt exists.
- Fixed-point accounting (integer millionths), fixed counter windows, server-side time, backward-commit-clock rejection, bounded live state, request deadlines and privacy-safe errors.
- Tenant-aware built-in task/session keys and explicit distributed-store checks.
- Package documentation, source/built-export regression tests, runtime integration cases and a separate real-server test target.

## Verification performed in this environment

- Node.js 22.16.0: **56 local unit/transport-contract tests passed; 0 failed/skipped.** The concurrency cases include 1,000 contending grouped attempts and 100 retries sharing one request ID.
- TypeScript 5.8.3: strict compile and declaration generation for `quota-reservations.ts` and `quota-redis.ts` passed, including exact optional fields, unchecked indexed access and unused checks.
- Lua source syntax parsed by the available local Lua interpreter. This is not Redis/Valkey execution or Redis Lua-version qualification.
- Feature catalog validates: 55 required features, 3 in progress, 52 planned, 0 verified; publication hold remains active.

The local tests load the two compiled reservation modules through a local ESM export shim. They are **not** a full tsup/public-package build. The runtime-facade integration tests were added to Vitest but have not been run here. The standalone real-server target was added, but no Redis/Valkey server is installed in this environment; it has not been executed. GitHub CI was not polled or retried.

## Still required for F55

Full runtime/built-package and Node matrix qualification; independent real Redis and Valkey runs; distributed partitions, reconnects, failover, server crashes, recovery, cache eviction/persistence configuration, adversarial testing and independent review. Circuit probes, loop histories and approval-use stores are not part of the quota transaction. External side effects are not made exactly-once by a reservation receipt. Namespace cutover must not silently discard existing quota state.

See `docs/runtime-quota-reservations.md` for the API, consistency boundary, capacity tradeoffs and migration procedure. The canonical F55 acceptance criteria are unchanged.
