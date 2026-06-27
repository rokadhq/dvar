# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates tool actions before side effects occur and returns a deterministic `allow`, `deny`, or `require_approval` decision.

> **Status:** `0.3.0-alpha.0`. The policy schema, lockfile, approval-grant, MCP, and runtime APIs remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## What v0.3 adds

Dvar v0.3 turns `require_approval` into an enforceable interruption and resume lifecycle:

- structured approval requests;
- HMAC-SHA256 signed approval grants;
- action-, identity-, policy-, scope-, and environment-bound grants;
- expiry and use-count enforcement;
- single-use replay protection by default;
- bounded `once`, `session`, and `task` scopes;
- pluggable approval-use stores;
- webhook approval-provider reference implementation;
- protected-tool automatic pause and resume;
- approval-aware MCP Streamable HTTP proxying;
- OpenAI Agents interruption helpers;
- privacy-conscious approval audit events.

## Define approval policy

```yaml
schemaVersion: "1"
version: "production-2026-06"
mode: enforce
defaultEffect: deny

runtime:
  onApprovalProviderError: deny

rules:
  - id: approve-large-refund
    priority: 500
    effect: require_approval
    when:
      tool.name: billing.refund
      arguments.amount:
        greaterThan: 1000
    approval:
      provider: webhook
      scope: once
      expiresInSeconds: 300
      maxUses: 1
      bind:
        - principal.id
        - agent.id
        - tenant.id
        - environment
        - server.id
        - tool.name
        - arguments
        - resources
        - destination
```

`once` grants always bind the semantic action hash and can be consumed once. `session` and `task` grants must bind their corresponding context identifiers and remain bounded by expiry and `maxUses`.

## Configure approvals

```ts
import { createDvar } from "@rokadhq/dvar";
import {
  createHmacApprovalSigner,
  createWebhookApprovalProvider,
  InMemoryApprovalUseStore
} from "@rokadhq/dvar/approvals";

const signer = createHmacApprovalSigner({
  issuer: "approval-service",
  secret: process.env.DVAR_APPROVAL_SECRET!
});

const dvar = await createDvar({
  policyPath: "dvar.yaml",
  lockfilePath: "dvar.lock.json",
  approval: {
    signer,
    useStore: new InMemoryApprovalUseStore(),
    provider: createWebhookApprovalProvider({
      endpoint: "https://approvals.example.com/dvar"
    })
  }
});
```

The in-memory store is intended for development and single-process deployments. Horizontally scaled enforcement requires a shared atomic implementation of `DvarApprovalUseStore`.

## Protect a tool

```ts
const refund = dvar.protectTool({
  name: "billing.refund",
  capabilities: ["finance.refund"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["paymentId", "amount"],
    properties: {
      paymentId: { type: "string", minLength: 1 },
      amount: { type: "number", exclusiveMinimum: 0 }
    }
  },
  execute: issueRefund
});
```

When a provider returns a signed grant immediately, Dvar verifies and consumes it before executing. Pending approval throws `DvarApprovalRequiredError`; rejection throws `DvarApprovalRejectedError`. The executor never runs before a valid decision permits it.

## Manual interruption and resume

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

Dvar uses a stable semantic action hash, so a new transport-level action ID does not invalidate a legitimate resume. Changing a bound argument, resource, destination, tenant, environment, tool, policy, or scope does invalidate it.

## MCP approval resume

The v0.3 MCP proxy automatically submits approval requests when a provider is configured. A delayed grant can be resubmitted through:

```text
X-Dvar-Approval-Grant: <signed-grant>
```

The header is consumed by Dvar and is never forwarded to the upstream MCP server. Existing attribution headers remain supported:

```text
X-Dvar-Principal-Id
X-Dvar-Principal-Type
X-Dvar-Agent-Id
X-Dvar-Tenant-Id
X-Dvar-Environment
X-Dvar-Session-Id
```

## OpenAI Agents adapter

```ts
import {
  createOpenAIAgentsNeedsApproval,
  resolveOpenAIAgentsInterruptions
} from "@rokadhq/dvar/adapters/openai-agents";

const needsApproval = createOpenAIAgentsNeedsApproval({
  evaluate: dvar.evaluate,
  toAction: (runContext, arguments_) =>
    normalizeAction(runContext, arguments_)
});

await resolveOpenAIAgentsInterruptions(
  result.state,
  result.interruptions,
  async (interruption) => review(interruption)
);
```

The adapter is structurally typed and does not add an SDK runtime dependency.

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

Scanning never mutates the reviewed lockfile. Caller authorization is not relayed by default.

## Security boundary

Dvar protects only actions routed through its wrapper or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, and network policy; it does not replace them.

Approval grants are sensitive authorization artifacts. Do not log them, place them in prompts or tool arguments, or forward them downstream. Use shared atomic use tracking for distributed deployments and keep signing keys outside agent context.

Approval interfaces should display the principal, agent, environment, tool, material arguments, affected resources, risk signals, scope, expiry, and reversibility.

## Current release surface

- deterministic policy and integrity enforcement;
- function-tool and MCP Streamable HTTP boundaries;
- canonical inventory, lockfile, and risk-aware diffs;
- bounded signed approval grants and provider interfaces;
- OpenAI Agents interruption helpers;
- policy tests and non-executing replay;
- privacy-conscious audit events;
- CLI: `init`, `validate`, `doctor`, `scan`, `inspect`, `lock`, `diff`, `test-policy`, `replay`, `proxy`, and `version`.

Distributed quotas, stdio supervision, output filtering, and OpenTelemetry exporters remain subsequent roadmap increments.
