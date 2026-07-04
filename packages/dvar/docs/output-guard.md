# Dvar Output Guard

`@rokadhq/dvar/output-guard` classifies, redacts, bounds, and blocks tool output before it reaches the caller or model context.

Version 0.6 supports JSON/text filtering, binary denial by default, max byte limits, configured field/path/pattern redaction, built-in secret redaction, configured deny patterns, protected-tool integration, and MCP JSON/text response filtering.

Output filtering is not summarization. Sensitive raw output must be filtered before any model-based transformation.
