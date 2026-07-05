# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates proposed tool actions and enforces policy, approvals, integrity, runtime safety, local-tool hardening, and output protection around side effects.

> **Status:** `0.6.0-alpha.0`. Policy, approval, runtime-safety, stdio, output-guard, MCP, and framework-adapter contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## What v0.6 adds

Dvar v0.6 adds post-execution output protection before tool output reaches the caller or model:

- JSON, text, binary, and unknown output classification;
- maximum byte-size enforcement;
- binary output denial by default;
- allowed content-type enforcement;
- configured field, path, and pattern redaction;
- built-in secret redaction for common token shapes;
- configured deny-pattern blocking;
- bounded output-safety summaries;
- protected-tool output filtering;
- MCP upstream JSON/text response filtering;
- bounded output metadata in audit events.

## Protect tool output

```ts
import { createDvar } from "@rokadhq/dvar";

const dvar = await createDvar({
  policyPath: "dvar.yaml",
  outputGuard: {
    policy: {
      maxBytes: 64_000,
      allowedContentTypes: ["json", "text"],
      redact: [
        { id: "email", field: "email" },
        { id: "internal-token", pattern: "token=[A-Za-z0-9._~+/=-]+" }
      ],
      deny: [
        { id: "prompt-injection", pattern: "ignore previous instructions" }
      ],
      markUntrusted: true
    }
  }
});
```

Protected tools return the filtered value. If output is denied, Dvar blocks return of the raw output and raises `DvarOutputPolicyError`.

## MCP output filtering

```ts
import { createMcpHttpProxy } from "@rokadhq/dvar/mcp";

const proxy = createMcpHttpProxy({
  upstream: "https://mcp.example.com/mcp",
  runtime: dvar,
  outputGuard: {
    policy: {
      maxBytes: 128_000,
      redactBuiltInSecrets: true,
      allowedContentTypes: ["json", "text"]
    }
  }
});
```

The MCP proxy filters JSON/text upstream responses before sending them back to the client. Streaming event responses are not semantically transformed in v0.6.

## Other active surfaces

- `@rokadhq/dvar/runtime-safety` for quotas, loop detection, circuit breakers, Redis/Valkey stores, and diagnostics.
- `@rokadhq/dvar/stdio` for local process supervision and host-tool hardening.
- `@rokadhq/dvar/approvals` for signed, bound, expiring approval grants.
- `@rokadhq/dvar/mcp` for MCP inventory, lockfiles, and Streamable HTTP enforcement.
- `@rokadhq/dvar/adapters/openai-agents` for OpenAI Agents interruption helpers.

## Security boundary

Dvar protects only actions and outputs routed through its wrapper, stdio supervisor, or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, network policy, and workload isolation; it does not replace them.

Output filtering is not summarization. A model-generated summary is not a security boundary. Sensitive raw output must be filtered before any model-based transformation.

See `docs/output-guard.md`, `docs/stdio-hardening.md`, `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
