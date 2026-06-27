# Dvar Threat Model

Dvar assumes model output, user content, retrieved content, tool metadata, schemas, annotations, MCP servers, tool output, approval requests, provider responses, and external destinations can be malicious or compromised.

Dvar reduces risk from excessive agency, prompt-induced unsafe actions, confused-deputy behavior, argument injection, cross-tenant access, destructive production operations, approval manipulation, replay, and MCP tool-definition changes by enforcing deterministic policy before execution.

Dvar does not claim to sandbox hostile processes, replace IAM or application authorization, detect every semantic misuse, prove that an MCP server implementation is benign, prove that an approver understood a request, or protect calls that bypass its wrapper or proxy boundary. Local stdio tools require OS-level isolation in addition to Dvar policy.

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

## v0.2 controls

- MCP Streamable HTTP initialization and paginated tool discovery;
- canonical inventories and explicit lockfile approval;
- detection of unknown servers and tools;
- detection of schema, description, annotation, endpoint, and capability changes;
- risk-aware inventory diffs;
- preflight-observed integrity checks on proxied tool calls;
- local denial or approval responses before upstream execution;
- session and negotiated protocol-header handling;
- trace-context forwarding;
- caller authorization suppression by default;
- loopback-only plaintext HTTP unless explicitly overridden.

## v0.3 controls

- structured approval requests derived from normalized action context;
- semantic action hashing that excludes ephemeral transport identifiers;
- signed grants bound to policy, rule, principal, agent, environment, server, tool, scope, and configured action fields;
- expiry and maximum-use enforcement;
- single-use replay resistance by default;
- bounded session and task grants;
- constant-time signature comparison;
- provider rejection and provider failure as distinct outcomes;
- strict-mode fail-closed behavior;
- approval values removed before MCP forwarding;
- approval lifecycle events that omit raw grant values;
- framework interruption helpers that preserve the host framework's run-state boundary.

## Residual risks

- capability inference is heuristic and must be reviewed;
- a lockfile proves inventory continuity, not benign implementation behavior;
- a compromised server can behave differently without changing its declared tool metadata;
- a reviewer can approve a misleading or insufficiently explained request;
- a compromised approval service or signing key can issue unauthorized grants;
- process-local replay tracking is insufficient for horizontally scaled enforcement;
- deliberately narrow session or task bindings may permit more variation than intended;
- tool output filtering is not yet implemented;
- the default header-based proxy identity must be protected by an authenticated front door when exposed beyond loopback;
- stdio process containment is not yet implemented.

## Later controls

Distributed quotas, loop detection, stdio supervision, output filtering, and OpenTelemetry exporters remain staged roadmap items.
