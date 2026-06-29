# Dvar Threat Model

Dvar assumes model output, user content, tool metadata, MCP servers, approval services, runtime state, accounting context, and external destinations can be incorrect or compromised.

Dvar reduces risk from excessive agency, unsafe tool use, confused-deputy behavior, cross-tenant actions, approval replay, runaway loops, budget exhaustion, dependency failure, and MCP definition changes by enforcing deterministic controls before execution.

Dvar does not replace IAM, application authorization, sandboxing, workload isolation, secrets management, or network policy. It cannot protect actions that bypass its wrapper or proxy boundary.

## v0.1–v0.3 controls

- deterministic policy precedence and explicit defaults;
- identity-aware normalized actions;
- argument validation and risk signals;
- policy tests, monitor mode, and non-executing replay;
- MCP inventory, lockfiles, and pre-execution proxying;
- signed, expiring, action-bound approval grants;
- bounded approval scopes and replay resistance.

## v0.4 controls

- execution-time task and session quotas;
- scoped call, cost, and monetary budgets;
- depth, retry, and consecutive-tool ceilings;
- repeated and alternating action-loop detection;
- circuit breakers with bounded recovery probes;
- atomic process-local and Redis/Valkey-compatible state stores;
- explicit shared-store requirements for multi-instance enforcement;
- strict-mode fail-closed runtime-store behavior;
- runtime usage included in approval bindings;
- runtime accounting headers removed before MCP forwarding;
- bounded runtime metadata in audit events.

## Residual risks

- capability inference and loop detection are heuristic;
- a lockfile proves inventory continuity, not benign implementation behavior;
- quota correctness depends on every execution path using Dvar and the same state namespace;
- accounting values are only as trustworthy as the system supplying them;
- conservative reservations may consume quota for actions later denied by another control;
- MCP circuit outcomes currently use HTTP-level success or failure;
- process-local state is insufficient for horizontally scaled enforcement;
- header-based identity and usage context require an authenticated front door;
- output filtering and stdio process containment are not yet implemented.

## Later controls

Grouped multi-control reservations, distributed leases, stdio supervision, output filtering, and OpenTelemetry exporters remain staged roadmap items.
