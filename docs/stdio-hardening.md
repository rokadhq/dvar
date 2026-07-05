# Dvar Stdio and Local-Tool Hardening

Dvar v0.5 introduces a local process boundary for tools that run through stdio or ordinary subprocess execution.

The goal is not to sandbox a hostile process. The goal is to ensure the host process starts only reviewed executables, with reviewed arguments, bounded environment, bounded filesystem context, bounded runtime, bounded output, and a Dvar action record.

## Execution model

`createStdioSupervisor()` executes with Node's `spawn` and `shell: false`. It does not interpolate through `/bin/sh`, `cmd.exe`, or a user shell.

Before execution, the supervisor:

1. resolves the executable realpath;
2. calculates the executable SHA-256;
3. discovers nearby package metadata when available;
4. applies command, executable, environment, argument, cwd, and path-root policy;
5. optionally calls `runtime.authorize(action)`;
6. starts the child process;
7. enforces timeout and output caps;
8. optionally records the execution outcome.

## Executable identity

Dvar can allowlist an executable by:

- exact command path;
- resolved realpath;
- SHA-256 digest;
- package name;
- package version.

Hash pinning is the strongest built-in identity check. Package name and version are metadata signals and should not be treated as a supply-chain guarantee by themselves.

## Environment policy

The supervisor validates only the environment explicitly supplied in the run request and passes only that environment to the child process. Parent-process environment variables are not inherited by default.

Use `envAllowlist` and `envDenylist` to keep secrets and deployment credentials out of local tools.

## Filesystem policy

Dvar enforces:

- allowed cwd roots;
- denied roots;
- path-argument roots for arguments that look like paths.

This is a pre-execution policy check, not kernel-level filesystem isolation. Use container mounts, OS permissions, chroot, namespaces, or sandboxing for stronger containment.

## Runtime bounds

Each execution can be bounded with:

- `timeoutMs`;
- `maxOutputBytes`;
- executable-specific defaults;
- global maximums.

When a timeout or output cap is reached, Dvar terminates the process and records a failed outcome when a runtime is attached.

## Dvar runtime integration

When a Dvar runtime is supplied, the supervisor builds a normalized stdio action and calls `authorize()` before spawning. The child process never starts when Dvar denies or requires unresolved approval.

The normalized action includes command, args, cwd, env keys, stdin byte count, executable hash, and package metadata. It intentionally does not include environment values.

## Residual risks

- A process that starts successfully can still exploit OS permissions if the host grants them.
- Path-argument detection is heuristic and cannot prove what the executable will access internally.
- Hashes identify the executable file, not all dynamic libraries, interpreters, plugins, or runtime-loaded code.
- Package metadata can be forged unless backed by a reviewed lockfile or external supply-chain control.
- Output content is only size-bounded in v0.5; semantic output filtering is planned for v0.6.
