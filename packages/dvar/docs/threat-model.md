# Dvar Threat Model

Dvar treats model output, tool metadata, MCP servers, approval services, runtime state, accounting context, local executables, package metadata, subprocess output, and external destinations as potentially incorrect or compromised.

Version 0.5 adds local process supervision with executable identity, argument checks, env filtering, cwd/path-root checks, timeouts, output caps, and optional runtime authorization.

Residual risks include execution paths that bypass Dvar, forged package metadata, dynamic code loaded after executable inspection, local OS permissions, untrusted accounting values, conservative quota reservations, and unfiltered output content.

Dvar complements IAM, application authorization, sandboxing, workload isolation, secrets management, database permissions, filesystem permissions, and network policy; it does not replace them.
