# Dvar Stdio Hardening

`@rokadhq/dvar/stdio` supervises local subprocess tools with reviewed executable identity, argument policy, cwd/path-root checks, env filtering, timeouts, output caps, and optional Dvar runtime authorization.

The supervisor runs with `shell: false` and does not inherit parent-process environment variables by default.

It is not a sandbox. Use OS/container isolation, filesystem permissions, network policy, and secret isolation alongside Dvar.

Output is size-bounded in v0.5. Semantic output filtering is a later phase.
