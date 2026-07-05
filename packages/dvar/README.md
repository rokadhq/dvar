# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It enforces policy, approvals, integrity, runtime safety, and local-tool hardening before side effects occur.

> **Status:** `0.5.0-alpha.0`. Public contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar
```

## Version 0.5

Dvar 0.5 adds `@rokadhq/dvar/stdio` for hardened local process execution:

- executable realpath and SHA-256 inspection;
- package metadata discovery;
- executable allowlisting by path, hash, or package identity;
- argument, cwd, path-root, and environment policy;
- supervised `spawn` with `shell: false`;
- timeouts and output caps;
- optional Dvar runtime authorization and outcome recording.

```ts
import { createStdioSupervisor } from "@rokadhq/dvar/stdio";

const supervisor = createStdioSupervisor({
  policy: {
    filesystem: { cwdRoots: ["/srv/agent/workspace"] },
    envAllowlist: ["NODE_ENV"],
    executables: [{
      id: "node-tool",
      realpath: "/usr/local/bin/node",
      sha256: "<reviewed-sha256>",
      args: { maxCount: 8, deny: ["--inspect"] }
    }]
  }
});
```

The stdio supervisor is not a sandbox. Use OS/container isolation, filesystem permissions, secrets management, and network policy alongside Dvar.

See `docs/stdio-hardening.md`, `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
