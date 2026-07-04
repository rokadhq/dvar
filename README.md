# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates proposed tool actions and enforces policy, approvals, integrity, runtime safety, and local-tool hardening before side effects occur.

> **Status:** `0.5.0-alpha.0`. Policy, approval, runtime-safety, stdio, MCP, and framework-adapter contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## What v0.5 adds

Dvar v0.5 adds a local stdio/process boundary for tools that run on the host:

- supervised process execution with `shell: false`;
- executable realpath and SHA-256 identity inspection;
- package metadata discovery from local `package.json`;
- executable allowlisting by path, hash, or package identity;
- absolute-command enforcement;
- command-argument count, allow, deny, and path-root checks;
- environment allowlist and denylist checks;
- cwd and path-argument root restrictions;
- process timeouts;
- stdout/stderr output caps;
- privacy-conscious action normalization that records env keys, not env values;
- optional Dvar runtime authorization and outcome recording.

## Supervise a local tool

```ts
import { createDvar } from "@rokadhq/dvar";
import { createStdioSupervisor } from "@rokadhq/dvar/stdio";

const dvar = await createDvar({ policyPath: "dvar.yaml" });
const supervisor = createStdioSupervisor({
  runtime: dvar,
  policy: {
    filesystem: {
      cwdRoots: ["/srv/agent/workspace"],
      pathArgumentRoots: ["/srv/agent/workspace"]
    },
    envAllowlist: ["NODE_ENV"],
    maxTimeoutMs: 10_000,
    maxOutputBytes: 64_000,
    executables: [{
      id: "node-tool",
      realpath: "/usr/local/bin/node",
      sha256: "<reviewed-executable-sha256>",
      args: {
        maxCount: 8,
        deny: ["--inspect", "--require"],
        validatePathArguments: true
      }
    }]
  }
});

const result = await supervisor.run({
  command: "/usr/local/bin/node",
  args: ["/srv/agent/workspace/tool.js"],
  cwd: "/srv/agent/workspace",
  env: { NODE_ENV: "production" },
  context: {
    principal,
    agent,
    tenant,
    task,
    environment: "production"
  }
});
```

The supervisor does not sandbox the child process. Use OS/container isolation, filesystem permissions, secrets management, and network policy alongside Dvar.

## Other active surfaces

- `@rokadhq/dvar/runtime-safety` for quotas, loop detection, circuit breakers, Redis/Valkey stores, and diagnostics.
- `@rokadhq/dvar/approvals` for signed, bound, expiring approval grants.
- `@rokadhq/dvar/mcp` for MCP inventory, lockfiles, and Streamable HTTP enforcement.
- `@rokadhq/dvar/adapters/openai-agents` for OpenAI Agents interruption helpers.

## Security boundary

Dvar protects only actions routed through its wrapper, stdio supervisor, or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, network policy, and workload isolation; it does not replace them.

See `docs/stdio-hardening.md`, `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
