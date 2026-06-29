# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates tool actions before side effects occur and returns deterministic `allow`, `deny`, or `require_approval` decisions.

> **Status:** `0.4.0-alpha.0`. Policy, approval, runtime-safety, MCP, and framework-adapter contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## What v0.4 adds

Dvar v0.4 adds stateful runtime controls at the execution boundary:

- task and session call quotas;
- scoped call, model-cost, and monetary budgets;
- depth and retry ceilings;
- consecutive-tool limits;
- repeated-action and alternating-action loop detection;
- circuit breakers with closed, open, and half-open states;
- in-memory and Redis/Valkey-compatible state stores;
- distributed-deployment diagnostics;
- runtime-aware MCP enforcement;
- runtime usage binding for approval grants;
- bounded runtime metadata in audit events.

## Runtime-safety policy

```yaml
schemaVersion: "1"
version: "production-2026-06"
mode: enforce
defaultEffect: deny

runtime:
  onRuntimeStoreError: deny
  requireDistributedStore: true

  maxToolCallsPerTask: 40
  maxToolCallsPerSession: 120
  maxConsecutiveToolCalls: 5
  maxDepth: 12
  maxRetries: 2

  quotas:
    - id: tenant-hourly-calls
      metric: calls
      limit: 500
      windowSeconds: 3600
      scope: [tenant]

    - id: tenant-daily-inr
      metric: monetary
      limit: 25000
      currency: INR
      windowSeconds: 86400
      scope: [tenant]
      onMissing: deny

  loopDetection:
    windowSeconds: 300
    historySize: 24
    maxRepeatedAction: 3
    maxOscillations: 3
    scope: [task]

  circuitBreakers:
    - id: production-billing
      failureThreshold: 5
      recoverySeconds: 60
      halfOpenMaxCalls: 1
      scope: [environment, server, tool]
      when:
        environment: production
        server.id: billing
```

## Evaluation versus execution authorization

`evaluate()` is intentionally side-effect-free. It is suitable for previews, policy tests, dry runs, and approval-request generation; it does not consume quotas or mutate circuit state.

Use `authorize()` immediately before an external side effect:

```ts
const decision = await dvar.authorize(action);

if (decision.effect !== "allow") {
  throw new Error(decision.message);
}

try {
  const result = await executeTool(action);
  await dvar.recordOutcome(action, { success: true });
  return result;
} catch (error) {
  await dvar.recordOutcome(action, {
    success: false,
    errorCode: error instanceof Error ? error.name : undefined
  });
  throw error;
}
```

`protectTool()` and the Dvar MCP proxy perform this authorization and outcome-recording flow automatically.

## Configure a shared runtime store

The core package does not require a Redis client. Supply a compatible client to the runtime-safety adapter:

```ts
import { createDvar } from "@rokadhq/dvar";
import {
  createRedisRuntimeStore
} from "@rokadhq/dvar/runtime-safety";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const dvar = await createDvar({
  policyPath: "dvar.yaml",
  runtimeSafety: {
    deploymentInstances: 4,
    keyPrefix: "dvar:production",
    store: createRedisRuntimeStore({ client: redis })
  }
});
```

`createValkeyRuntimeStore()` accepts the same minimal `eval`/`ping` interface. Dvar refuses process-local state when policy requires a distributed store or when `deploymentInstances` is greater than one with stateful controls enabled.

## Usage accounting

Protected function tools receive accounting context through `DvarToolContext.usage`:

```ts
await protectedTool(arguments_, {
  principal,
  agent,
  tenant,
  task,
  environment: "production",
  usage: {
    retry: 0,
    cost: 0.032,
    monetaryValue: 1500,
    currency: "INR"
  }
});
```

The MCP proxy accepts equivalent local-only headers:

```text
X-Dvar-Retry
X-Dvar-Cost
X-Dvar-Monetary-Value
X-Dvar-Currency
```

Dvar consumes these headers locally and does not forward them upstream. When approval is required, the reviewed usage values are included in the action binding, so they cannot be increased after approval without invalidating the grant.

## Approval lifecycle

Dvar v0.3 approval features remain available through `@rokadhq/dvar/approvals`:

- structured requests;
- HMAC-SHA256 signed grants;
- bounded `once`, `session`, and `task` scopes;
- replay protection;
- webhook providers;
- protected-tool and MCP interruption/resume;
- OpenAI Agents interruption helpers.

```ts
const decision = await dvar.evaluate(action);
const request = decision.approvalRequest;

if (request) {
  const grant = await signer.issue(request, {
    approver: { id: "reviewer-42", type: "user" }
  });

  const resumed = await dvar.resume(
    { ...action, id: crypto.randomUUID() },
    grant.token
  );
}
```

## MCP inventory and enforcement

```bash
npx dvar scan https://mcp.example.com/mcp \
  --server-id production-crm \
  --out dvar.inventory.json

npx dvar diff dvar.inventory.json --lockfile dvar.lock.json
npx dvar lock dvar.inventory.json --out dvar.lock.json

npx dvar proxy \
  --upstream https://mcp.example.com/mcp \
  --server-id production-crm \
  --policy dvar.yaml \
  --lockfile dvar.lock.json \
  --listen 127.0.0.1:4319
```

Scanning never mutates the reviewed lockfile. Caller authorization, approval grants, and runtime-accounting headers are not relayed upstream by default.

## Operational diagnostics

```ts
const diagnostics = await dvar.diagnostics();
```

Diagnostics report enabled controls, store kind and health, whether state is distributed, deployment-instance assumptions, and warnings such as process-local enforcement.

## Security boundary

Dvar protects only actions routed through its wrapper or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, network policy, and workload isolation; it does not replace them.

Runtime quotas are conservative reservations: if multiple controls apply and a later control denies, an earlier counter may already have been consumed. Cost and monetary values must come from a trusted accounting layer rather than model-generated content. Circuit-breaker outcomes currently reflect protected-tool execution results and MCP HTTP-level success or failure.

See `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
