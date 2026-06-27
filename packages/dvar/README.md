# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates tool actions before side effects occur and returns a deterministic `allow`, `deny`, or `require_approval` decision.

> **Status:** `0.1.0-alpha.0`. The policy schema and runtime API are intentionally pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## Initialize policy

```bash
npx dvar init
npx dvar validate
npx dvar test-policy
```

The generated policy starts in `monitor` mode with an intended enforced default of `deny`.

## Protect a tool

```ts
import { createDvar } from "@rokadhq/dvar";

const dvar = await createDvar({ policyPath: "dvar.yaml" });

const readCustomer = dvar.protectTool({
  name: "crm.read_customer",
  capabilities: ["data.read"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["customerId"],
    properties: {
      customerId: { type: "string", minLength: 1 }
    }
  },
  execute: async ({ customerId }: { customerId: string }) => {
    return { customerId, status: "active" };
  }
});

const customer = await readCustomer(
  { customerId: "customer-1" },
  {
    principal: { id: "user-1", type: "user" },
    agent: { id: "support-agent" },
    tenant: { id: "tenant-a" },
    environment: "production"
  }
);
```

In `monitor` mode Dvar executes the tool but preserves the underlying result as `would_allow`, `would_deny`, or `would_require_approval`. In `enforce` and `strict` modes, denied calls throw `DvarDeniedError`, and approval-gated calls throw `DvarApprovalRequiredError` before the executor runs.

## Current v0.1 surface

- declarative YAML and JSON policy;
- deterministic precedence;
- monitor, enforce, strict, and off modes;
- generic JavaScript/TypeScript tool wrapper;
- JSON Schema argument validation;
- stable reason codes and privacy-conscious audit events;
- embedded policy tests;
- JSONL replay that never invokes tools;
- CLI: `init`, `validate`, `doctor`, `test-policy`, `replay`, and `version`.

MCP proxying, lockfile inventory enforcement, signed approvals, runtime quotas, stdio supervision, and output policy are subsequent roadmap increments.

## Security boundary

Dvar only protects actions that pass through its interception boundary. It complements application authorization, IAM, sandboxing, secrets management, database permissions, and network policy; it does not replace them.
