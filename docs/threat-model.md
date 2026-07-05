# Dvar Threat Model

Dvar treats model output, tool metadata, framework adapters, MCP servers, approval services, runtime state, accounting context, local executables, local package metadata, subprocess output, tool output, and external destinations as potentially incorrect or compromised.

Dvar reduces risk from excessive agency, unsafe tool use, confused-deputy behavior, cross-tenant actions, approval replay, runaway loops, budget exhaustion, dependency failure, local command abuse, environment leakage, filesystem-path misuse, secret leakage, oversized output, prompt-injection content in tool results, framework bypass, and MCP definition changes by enforcing deterministic controls before and after execution.

Dvar does not replace IAM, application authorization, sandboxing, workload isolation, secrets management, filesystem permissions, data classification systems, or network policy. It cannot protect actions or outputs that bypass its wrapper, stdio supervisor, proxy boundary, or framework adapter wrapper.

## v0.1–v0.5 controls

- deterministic policy precedence and explicit defaults;
- identity-aware normalized actions;
- argument validation and risk signals;
- policy tests, monitor mode, and non-executing replay;
- MCP inventory, lockfiles, and pre-execution proxying;
- signed, expiring, action-bound approval grants;
- runtime quotas, loop detection, circuit breakers, and shared state;
- local process supervision with executable identity, env filtering, and path-root checks.

## v0.6 controls

- post-execution output filtering;
- output size limits;
- JSON/text/binary content classification;
- binary output denial by default;
- configured redaction by field, path, or pattern;
- built-in secret redaction for common token shapes;
- configured deny-pattern blocking;
- protected-tool output filtering before return;
- MCP JSON/text response filtering;
- bounded output-safety audit metadata.

## v0.7 controls

- structural framework adapter for Vercel AI SDK-style tools;
- protected execution wrappers for framework tool calls;
- Dvar-composed framework approval hints;
- per-call Dvar context resolution;
- adapter conformance runner.

## Residual risks

- built-in secret patterns are not complete DLP;
- regex rules can miss encoded, fragmented, or transformed secrets;
- field/path redaction assumes predictable response shape;
- MCP event streams are not semantically transformed in v0.6;
- framework adapters protect only wrapped tool objects;
- framework-native approval hints do not replace Dvar policy enforcement;
- hash identity does not cover dynamic libraries, interpreters, plugins, or runtime-loaded code;
- local processes can still access everything permitted by the OS;
- quota correctness depends on every execution path using Dvar and the same state namespace;
- accounting values are only as trustworthy as the system supplying them;
- conservative reservations may consume quota for actions later denied by another control;
- header-based identity and usage context require an authenticated front door.

## Later controls

Deeper DLP, structured provenance labels, output schema validation, grouped multi-control reservations, distributed leases, deeper stdio sandbox integrations, OpenTelemetry exporters, and additional framework adapters remain staged roadmap items.
