# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It enforces policy, approvals, integrity, runtime safety, local-tool hardening, output protection, and framework-adapter controls around side effects.

> **Status:** `0.7.0` on npm's `alpha` channel. Public contracts remain pre-stable.

## Install

```bash
npm install @rokadhq/dvar@alpha
```

## Version 0.7

Dvar 0.7 adds `@rokadhq/dvar/adapters/vercel-ai-sdk` and `@rokadhq/dvar/adapters/conformance`.

```ts
import { protectVercelAISDKTools } from "@rokadhq/dvar/adapters/vercel-ai-sdk";

const protectedTools = protectVercelAISDKTools(tools, {
  runtime: dvar,
  context,
  toDvarInputSchema: (toolName) => jsonSchemas[toolName]
});
```

The Vercel AI SDK adapter is structural and dependency-free. It wraps AI SDK-style tools, composes `needsApproval`, and routes `execute` through Dvar protected tools.

Use `docs/framework-adapters.md` for details and security boundaries.
