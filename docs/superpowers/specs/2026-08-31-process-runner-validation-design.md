# ProcessRunner and Validation Evidence Design

## Scope

This v0.2 slice adds reliable non-interactive command execution and command-based validation evidence. It does not add a shell-string tool, interactive terminal, package installation, sudo handling, autonomous tool calls, or resumable long-running processes.

## Considered approaches

1. **Structured one-shot runner with an extensible port — selected.** It delivers deterministic build/test/lint/typecheck evidence now and leaves process-handle management for a later slice.
2. **Managed long-process service first.** Better for dev servers, but adds persistence, handles, UI lifecycle, and restart semantics before the MVP needs them.
3. **VS Code Terminal execution.** Familiar UI, but output scraping and exit-state inference violate the machine-deterministic validation contract.

## Architecture

```text
ValidationEngine / future RunCommand tool
                ↓
          ProcessRunner port
                ↓
       NodeProcessRunner adapter
                ↓
 child_process.spawn(executable, args, shell:false)
                ↓
 LinuxProcessTreeController / development fallback
```

The domain contract contains no Node or VS Code types. Infrastructure owns spawning, stream capture, timers, and OS signal behavior. The application validation layer consumes only normalized `ProcessResult` values.

## Process request and result

A request declares:

- `executable` and an exact `args` array;
- canonical execution-workspace `cwd`;
- optional environment overrides, timeout, output byte limit, and termination grace period;
- stdin policy fixed to closed for this slice.

The result records:

- terminal status: `exited | cancelled | timedOut | spawnFailed`;
- exit code and signal where available;
- separately captured stdout and stderr;
- byte counts and truncation flags for both streams;
- duration and a bounded spawn-error message.

Output capture keeps the first portion and final portion of an over-limit stream so both the command start and failure tail remain useful. Raw environment values are never returned or logged.

## Cancellation and Linux process trees

Linux commands start as detached process-group leaders. Abort or timeout sends SIGTERM to the owned negative process-group id, waits a bounded grace period, then sends SIGKILL only to that same group if the child has not exited. It never uses `pkill`, command matching, or shell syntax. A direct-child controller exists only so tests and development can run on the current non-Linux host; Linux is the formal delivery behavior.

## Validation

`ValidationEngine` accepts structured command steps for build, test, lint, typecheck, and Ruyi checks. It executes sequentially, stops after the first failed/cancelled/timed-out step, and returns evidence containing the exact executable/args/cwd, normalized status, exit code, duration, truncation flags, and bounded output summary. Empty plans return `passed: false` with an explicit no-evidence reason; validation never turns “nothing ran” into success.

VS Code Diagnostics remains a separate future `DiagnosticsProvider`; it will be combined with command evidence without pretending diagnostics are shell commands.

## Security and permission boundary

The runner does not authorize itself. Future callers must validate the request and pass its declared `processExec`/higher-risk metadata through `PermissionEngine` before invoking the port. Shell metacharacters inside an argument remain literal because `shell:false`; shell pipelines require a separate higher-risk tool that is outside this scope.

## Verification

Tests cover stdout/stderr/exit code, argument boundaries, cwd with spaces, environment overrides without result leakage, output truncation, timeout, cancellation, spawn failure, terminal-event races, and sequential validation evidence. Linux process-group integration remains a Linux CI/release acceptance item; controller behavior is unit-tested with an injected process host on the current machine.
