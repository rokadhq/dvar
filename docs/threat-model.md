# Dvar Threat Model

Dvar treats model output, tool metadata, MCP servers, approval services, runtime state, accounting context, local executables, local package metadata, subprocess output, and external destinations as potentially incorrect or compromised.

Dvar reduces risk from excessive agency, unsafe tool use, confused-deputy behavior, cross-tenant actions, approval replay, runaway loops, budget exhaustion, dependency failure, local command abuse, environment leakage, filesystem-path misuse, and MCP definition changes by enforcing deterministic controls before execution.

Dvar does not replace IAM, application authorization, sandboxing, workload isolation, secrets management, filesystem permissions, or network policy. It cannot protect actions that bypass its wrapper, stdio supervisor, or proxy boundary.

## v0.1–v0.4 controls

- deterministic policy precedence and explicit defaults;
- identity-aware normalized actions;
- argument validation and risk signals;
- policy tests, monitor mode, and non-executing replay;
- MCP inventory, lockfiles, and pre-execution proxying;
- signed, expiring, action-bound approval grants;
- runtime quotas, loop detection, circuit breakers, and shared state.

## v0.5 controls

- local process execution with `shell: false`;
- executable realpath and hash identity;
- package metadata signals;
- executable allowlisting;
- environment allowlist and denylist enforcement;
- cwd and path-argument root checks;
- command-argument pattern checks;
- process timeouts and output caps;
- Dvar runtime authorization before local execution;
- outcome recording after supervised execution.

## Residual risks

- capability inference and path-argument detection are heuristic;
- hash identity does not cover dynamic libraries, interpreters, plugins, or runtime-loaded code;
- package metadata can be forged without external supply-chain controls;
- local processes can still access everything permitted by the OS;
- quota correctness depends on every execution path using Dvar and the same state namespace;
- accounting values are only as trustworthy as the system supplying them;
- conservative reservations may consume quota for actions later denied by another control;
- output content is not semantically filtered in v0.5;
- header-based identity and usage context require an authenticated front door.

## Later controls

Output filtering, grouped multi-control reservations, distributed leases, deeper stdio sandbox integrations, and OpenTelemetry exporters remain staged roadmap items.
