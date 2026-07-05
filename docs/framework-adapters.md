# Dvar Framework Adapters

Dvar v0.7 introduces framework adapters that let application teams keep their existing agent framework shape while routing tool execution through Dvar.

Adapters are intentionally structural. Dvar does not require a specific framework package at runtime unless the adapter cannot be represented without it.

## Vercel AI SDK

`@rokadhq/dvar/adapters/vercel-ai-sdk` wraps AI SDK-style tool objects. It preserves the original tool metadata and replaces `execute` with a Dvar-protected execution function.

```ts
import { tool } from "ai";
import { z } from "zod";
import { createDvar } from "@rokadhq/dvar";
import { protectVercelAISDKTools } from "@rokadhq/dvar/adapters/vercel-ai-sdk";

const dvar = await createDvar({ policyPath: "dvar.yaml" });

export const tools = protectVercelAISDKTools({
  weather: tool({
    description: "Get weather for a location",
    inputSchema: z.object({ location: z.string() }),
    execute: async ({ location }) => ({ location, temperature: 27 })
  })
}, {
  runtime: dvar,
  contextResolver: ({ executionOptions }) => ({
    principal: { id: "user-1", type: "user" },
    agent: { id: "assistant", framework: "vercel-ai-sdk" },
    environment: "production",
    session: { id: "session-1" },
    metadata: { requestId: executionOptions?.requestId }
  })
});
```

### Input schemas

The adapter preserves the original `inputSchema` for the AI SDK. If the schema is already JSON Schema, Dvar uses it for argument validation. If the schema is a Zod schema, provide `toDvarInputSchema` to supply a JSON Schema version for Dvar.

```ts
protectVercelAISDKTools(tools, {
  runtime: dvar,
  context,
  toDvarInputSchema: (toolName) => schemas[toolName]
});
```

### Approval behavior

The adapter composes the original AI SDK `needsApproval` value with a side-effect-free Dvar evaluation. If either the original tool or Dvar requires approval, `needsApproval` resolves to `true`.

Execution is still enforced by Dvar. The native framework approval flag is a user-experience hint, not a replacement for Dvar policy enforcement.

### Conformance

`@rokadhq/dvar/adapters/conformance` exports a tiny framework-neutral conformance runner. Adapter packages and userland wrappers can use it to check expected allow, deny, approval, output-filtering, and metadata behavior without depending on a specific test framework.

## Boundary

Framework adapters only protect calls routed through the wrapped tool objects. Calls to the original unwrapped tool objects bypass Dvar.
