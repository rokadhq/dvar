# API Stability

Dvar is currently pre-1.0.

The following are deliberate contracts but may still evolve with documented migration guidance:

- terminal effects: `allow`, `deny`, `require_approval`;
- modes: `off`, `monitor`, `enforce`, `strict`;
- approval scopes: `once`, `session`, `task`;
- runtime metrics: `calls`, `cost`, `monetary`;
- runtime scope dimensions: global, principal, agent, tenant, session, task, environment, server, tool, destination;
- output guard statuses: `allowed`, `redacted`, `denied`;
- output content classes: `json`, `text`, `binary`, `unknown`;
- side-effect-free `evaluate()` and execution-time `authorize()` separation;
- framework adapter boundary: wrapped tools are protected, original unwrapped tools are not;
- stdio supervisor default of `shell: false` and no parent-environment inheritance;
- canonical policy, inventory, and lockfile names;
- versioned policy, inventory, lockfile, and approval request records;
- stable machine-readable reason-code namespace.

The MCP scanner/proxy, output-guard policy shape, built-in redaction patterns, framework adapter helper signatures, Vercel AI SDK structural tool typing, adapter conformance helper shape, inferred capability vocabulary, inventory-diff taxonomy, approval-provider and approval-use-store interfaces, compact grant format, runtime-store interface, Redis/Valkey adapters, quota reservation semantics, stdio supervisor policy shape, local package metadata discovery, loop fingerprints, circuit-breaker outcome interpretation, and framework adapters remain experimental before 1.0. Breaking changes require release notes and migration guidance.

A stable 1.x release will preserve valid schema-version-1 policies within the documented compatibility guarantees.
