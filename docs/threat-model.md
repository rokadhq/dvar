# Dvar Threat Model

Dvar assumes model output, user content, retrieved content, tool metadata, schemas, annotations, MCP servers, tool output, and external destinations can be malicious or compromised.

The initial runtime reduces risk from excessive agency, prompt-induced unsafe actions, confused-deputy behavior, argument injection, cross-tenant access, destructive production operations, and approval-sensitive actions by enforcing deterministic policy before execution.

Dvar does not claim to sandbox hostile processes, replace IAM or application authorization, detect every semantic misuse, or protect calls that bypass its wrapper or proxy boundary. Local stdio tools will require OS-level isolation in addition to Dvar policy.

## v0.1 controls

- explicit default effect;
- deny-over-allow and approval-over-allow precedence;
- required principal, agent, tenant, and environment context where configured;
- typed action normalization;
- JSON Schema argument validation;
- capability-aware contextual risk signals;
- privacy-conscious structured decision events;
- monitor-mode migration without hiding the underlying enforcement result;
- policy tests and replay without tool execution.

## Later controls

MCP inventory integrity, signed approval grants, distributed quotas, loop detection, stdio supervision, output filtering, and OpenTelemetry integration are staged roadmap items and must not be represented as shipped in v0.1.
