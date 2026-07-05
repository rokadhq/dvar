# Dvar Threat Model

Dvar treats model output, tool metadata, MCP servers, approval services, runtime state, accounting context, and external destinations as potentially incorrect or compromised.

Version 0.4 adds execution-time quotas, depth/retry ceilings, loop detection, circuit breakers, shared-store requirements, strict-mode store failure behavior, usage-bound approvals, and runtime-aware MCP enforcement.

Residual risks include execution paths that bypass Dvar, inconsistent distributed key namespaces, untrusted accounting values, conservative quota reservations, loop false positives, HTTP-level MCP circuit outcomes, and unauthenticated identity or usage headers.

Dvar complements IAM, application authorization, sandboxing, workload isolation, secrets management, database permissions, and network policy; it does not replace them.
