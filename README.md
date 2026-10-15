# `@rokadhq/dvar`

Dvar is the policy firewall for AI agents. It evaluates proposed tool actions and enforces policy, approvals, integrity, runtime safety, local-tool hardening, output protection, and framework-adapter controls around side effects.

> **Status:** v1.0 development; publication is on hold. All 55 features in the [v1 implementation plan](docs/v1/IMPLEMENTATION_PLAN.md) must be qualified before the first v1 release. The existing 0.7.0 code is a development baseline, not a production sign-off.

## Develop locally

No alpha/beta release is planned. From a repository checkout:

```bash
npm install
npm run check
```

`npm run check:v1-release` deliberately fails until all feature and release gates
are approved. `npm publish` is also gated. See the [network-security foundation](docs/network-security.md)
for the first v1 development slice. Historical v0.7 APIs below remain pre-stable.

## What v0.7 adds

Dvar v0.7 starts the framework ecosystem layer:

- `@rokadhq/dvar/adapters/vercel-ai-sdk`;
- dependency-free structural wrapping for Vercel AI SDK-style tools;
- protected execution for AI SDK-style `execute` functions;
- composed `needsApproval` using framework rules plus Dvar evaluation;
- per-call Dvar context resolution;
- JSON Schema passthrough for Dvar argument validation;
- `toDvarInputSchema` hook for Zod or custom schema conversion;
- `@rokadhq/dvar/adapters/conformance`;
- framework-neutral adapter conformance runner.

## Protect Vercel AI SDK tools

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import { createDvar } from "@rokadhq/dvar";
import { protectVercelAISDKTools } from "@rokadhq/dvar/adapters/vercel-ai-sdk";

const dvar = await createDvar({ policyPath: "dvar.yaml" });

const tools = protectVercelAISDKTools({
  weather: tool({
    description: "Get weather for a location",
    inputSchema: z.object({ location: z.string() }),
    execute: async ({ location }) => ({ location, temperature: 27 })
  })
}, {
  runtime: dvar,
  context: {
    principal: { id: "user-1", type: "user" },
    agent: { id: "assistant", framework: "vercel-ai-sdk" },
    environment: "production",
    session: { id: "session-1" }
  }
});

const result = await generateText({
  model,
  tools,
  prompt: "What is the weather in Bhubaneswar?"
});
```

The adapter preserves the framework-facing tool shape and routes execution through Dvar. The original unwrapped tool object is not protected.

## Other active surfaces

- `@rokadhq/dvar/network` for explicit, default-deny, IP-pinned bounded HTTP(S) requests.

- `@rokadhq/dvar/runtime-safety` for quotas, loop detection, circuit breakers, Redis/Valkey stores, and diagnostics.
- `@rokadhq/dvar/output-guard` for output classification, redaction, and blocking.
- `@rokadhq/dvar/stdio` for local process supervision and host-tool hardening.
- `@rokadhq/dvar/approvals` for signed, bound, expiring approval grants.
- `@rokadhq/dvar/mcp` for MCP inventory, lockfiles, and Streamable HTTP enforcement.
- `@rokadhq/dvar/adapters/openai-agents` for OpenAI Agents interruption helpers.

## Security boundary

Dvar protects only actions and outputs routed through its wrapper, stdio supervisor, or proxy boundary. It complements application authorization, IAM, OAuth, sandboxing, secrets management, database permissions, network policy, and workload isolation; it does not replace them.

Framework adapters are convenience integration boundaries, not framework sandboxes. Calls to unwrapped tools bypass Dvar.

See `docs/framework-adapters.md`, `docs/output-guard.md`, `docs/stdio-hardening.md`, `docs/runtime-safety.md`, `docs/approvals.md`, `docs/mcp-security.md`, and `docs/threat-model.md` for detailed contracts and residual risks.
