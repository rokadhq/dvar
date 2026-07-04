# Dvar Threat Model

Dvar treats model output, tool metadata, framework adapters, MCP servers, approval services, runtime state, accounting context, local executables, package metadata, subprocess output, tool output, and external destinations as potentially incorrect or compromised.

Version 0.7 adds a structural Vercel AI SDK adapter, protected framework-tool execution wrappers, composed approval hints, per-call context resolution, and an adapter conformance runner.

Residual risks include outputs or actions that bypass Dvar, incomplete secret detection, encoded or fragmented secrets, unpredictable response shapes, unfiltered MCP event streams, unwrapped framework tools, framework-native approval hints that do not replace Dvar enforcement, forged package metadata, dynamic code loaded after executable inspection, local OS permissions, and untrusted accounting values.

Dvar complements IAM, application authorization, sandboxing, workload isolation, secrets management, database permissions, filesystem permissions, data classification, and network policy; it does not replace them.
