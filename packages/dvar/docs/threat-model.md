# Dvar Threat Model

Dvar treats model output, tool metadata, MCP servers, approval services, runtime state, accounting context, local executables, package metadata, subprocess output, tool output, and external destinations as potentially incorrect or compromised.

Version 0.6 adds output filtering with content classification, size enforcement, binary denial by default, field/path/pattern redaction, built-in secret redaction, deny-pattern blocking, protected-tool integration, and MCP JSON/text response filtering.

Residual risks include outputs that bypass Dvar, incomplete secret detection, encoded or fragmented secrets, unpredictable response shapes, unfiltered MCP event streams, forged package metadata, dynamic code loaded after executable inspection, local OS permissions, and untrusted accounting values.

Dvar complements IAM, application authorization, sandboxing, workload isolation, secrets management, database permissions, filesystem permissions, data classification, and network policy; it does not replace them.
