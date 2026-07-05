# Dvar Framework Adapters

`@rokadhq/dvar/adapters/vercel-ai-sdk` wraps Vercel AI SDK-style tools while preserving the tool shape expected by `generateText` and `streamText`.

The adapter is structural and dependency-free: Dvar does not require `ai` or `zod` as package dependencies.

Use `protectVercelAISDKTools()` to wrap a tools object, compose `needsApproval`, and route execution through Dvar protected tools.

Use `@rokadhq/dvar/adapters/conformance` to run framework-neutral adapter conformance checks.
