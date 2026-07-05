# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates tool actions before side effects occur and returns a deterministic `allow`, `deny`, or `require_approval` decision.

> **Status:** `0.2.0-alpha.0`. The policy schema, lockfile format, MCP API, and runtime API remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## What v0.2 adds

Dvar v0.2 adds the first MCP security boundary:

- Streamable HTTP initialization and `tools/list` discovery;
- canonical tool inventories and `dvar.lock.json` generation;
- risk-aware diffs for tool, schema, annotation, capability, endpoint, and integrity changes;
- deterministic lockfile enforcement for unknown or changed MCP capabilities;
- an MCP Streamable HTTP proxy that evaluates `tools/call` before forwarding;
- MCP session and protocol-header handling;
- trace-context propagation;
- explicit upstream credential handling—caller authorization is not relayed by default.

Dvar targets the stable `2025-11-25` MCP protocol generation. It does not opt into unreleased protocol revisions automatically.

## Initialize policy

```bash
npx dvar init
npx dvar validate
npx dvar test-policy
```

The generated policy starts in `monitor` mode with an intended enforced default of `deny`.

## Inspect and lock an MCP server

```bash
npx dvar scan https://mcp.example.com/mcp \
  --server-id production-crm \
  --out dvar.inventory.json

npx dvar diff dvar.inventory.json --lockfile dvar.lock.json
npx dvar lock dvar.inventory.json --out dvar.lock.json
```

`dvar lock` is always explicit. Scanning never mutates the reviewed lockfile.

Authenticated scanning uses a configured header without persisting its value:

```bash
npx dvar scan https://mcp.example.com/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

## Enforce MCP tool calls

```bash
npx dvar proxy \
  --upstream https://mcp.example.com/mcp \
  --server-id production-crm \
  --policy dvar.yaml \
  --lockfile dvar.lock.json \
  --listen 127.0.0.1:4319 \
  --upstream-header "Authorization: Bearer $MCP_TOKEN"
```

Point the MCP client at `http://127.0.0.1:4319` instead of the upstream server.

Dvar accepts attributable request context through:

```text
X-Dvar-Principal-Id
X-Dvar-Principal-Type
X-Dvar-Agent-Id
X-Dvar-Tenant-Id
X-Dvar-Environment
X-Dvar-Session-Id
```

The proxy preserves `MCP-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID`, `traceparent`, and `tracestate`. It does not forward the caller's `Authorization` header unless `--forward-authorization` is explicitly supplied. Prefer a dedicated `--upstream-header` credential instead.

## Integrity policy

```yaml
schemaVersion: "1"
mode: monitor
defaultEffect: deny

integrity:
  requireLockfile: true
  onUnknownServer: deny
  onUnknownTool: require_approval
  onDescriptionChange: require_approval
  onSchemaChange: deny
  onCapabilityExpansion: deny
```

In `strict` mode, undeclared integrity failure behavior defaults to denial. In `monitor` mode, Dvar forwards the call while preserving `would_deny` or `would_require_approval` in the decision record.

## Protect an ordinary function tool

```ts
import { createDvar } from "@rokadhq/dvar";

const dvar = await createDvar({
  policyPath: "dvar.yaml",
  lockfilePath: "dvar.lock.json"
});

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
  execute: async ({ customerId }: { customerId: string }) => ({
    customerId,
    status: "active"
  })
});
```

## Current release surface

- declarative YAML and JSON policy;
- deterministic precedence;
- monitor, enforce, strict, and off modes;
- generic JavaScript/TypeScript tool wrapper;
- JSON Schema argument validation;
- MCP Streamable HTTP scanner and policy proxy;
- canonical inventory, lockfile, and risk-aware diff;
- stable reason codes and privacy-conscious audit events;
- embedded policy tests;
- JSONL replay that never invokes tools;
- CLI: `init`, `validate`, `doctor`, `scan`, `inspect`, `lock`, `diff`, `test-policy`, `replay`, `proxy`, and `version`.

Signed approval grants, distributed runtime quotas, stdio supervision, output filtering, and OpenTelemetry exporters remain subsequent roadmap increments.

## Security boundary

Dvar protects only actions routed through its wrapper or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, and network policy; it does not replace them.

The capability classifier is heuristic. Server descriptions and annotations are untrusted hints. Review every lockfile diff before accepting it.
