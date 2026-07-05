# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It enforces policy, approvals, integrity, and runtime-safety controls before tool side effects occur.

> **Status:** `0.4.0-alpha.0`. Public contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## Version 0.4

Dvar 0.4 adds execution-time quotas, loop detection, circuit breakers, shared runtime stores, runtime-aware MCP enforcement, and usage-bound approvals.

```yaml
runtime:
  onRuntimeStoreError: deny
  requireDistributedStore: true
  maxToolCallsPerTask: 40
  maxDepth: 12
  maxRetries: 2

  quotas:
    - id: tenant-daily-inr
      metric: monetary
      limit: 25000
      currency: INR
      windowSeconds: 86400
      scope: [tenant]

  loopDetection:
    maxRepeatedAction: 3
    maxOscillations: 3
    scope: [task]

  circuitBreakers:
    - id: production-billing
      failureThreshold: 5
      recoverySeconds: 60
      scope: [environment, server, tool]
```

Use `@rokadhq/dvar/runtime-safety` for the in-memory store, Redis/Valkey-compatible adapters, store contracts, and diagnostics.

`evaluate()` is side-effect-free and does not consume quotas. Use `authorize()`, `protectTool()`, or the MCP proxy immediately before execution. Call `recordOutcome()` after manually authorized execution so circuit breakers receive the result.

Process-local runtime state is valid only for one enforcement process. Multi-instance deployments require a shared atomic store.

See `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
