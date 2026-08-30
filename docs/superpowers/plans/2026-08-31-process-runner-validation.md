# ProcessRunner and Validation Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded, cancellable, Linux-process-group-aware ProcessRunner and use it to produce honest command validation evidence.

**Architecture:** Domain-owned request/result ports isolate application validation from Node spawning. The Node adapter uses `spawn(executable,args,{shell:false})`, injected process-tree termination, bounded dual-stream capture, and one terminal-state gate. Validation consumes normalized results sequentially.

**Tech Stack:** TypeScript 5.7, Node.js `child_process`, Node built-in test runner, no new dependency.

## Global Constraints

- First-party production code remains TypeScript/JavaScript.
- Linux local VS Code is the formal target; no Remote-SSH or shell-startup logic.
- Commands use exact executable/args with `shell:false`; no shell-string fallback.
- No sudo password collection, secret logging, Terminal scraping, or fuzzy process killing.
- Permission decisions remain outside the runner.
- Every implementation change follows RED → GREEN and is committed only after verification.

---

### Task 1: Process domain contract and bounded output accumulator

**Files:**
- Modify: `src/yisi/domain/process.ts`
- Create: `src/yisi/infrastructure/process/boundedOutput.ts`
- Test: `test/bounded-output.test.js`

**Interfaces:**
- Produces `ProcessStatus`, `ProcessRequest`, `CapturedOutput`, `ProcessResult`, and `ProcessRunner`.
- Produces `BoundedOutput.append(chunk)` and `snapshot()` with head/tail retention, total bytes, and `truncated`.

- [x] Write failing tests for below-limit UTF-8, multi-byte/chunk boundaries, truncation head/tail, and zero secret/environment serialization.
- [x] Run `npm test` and confirm the new module is missing.
- [x] Implement byte-based bounded capture without decoding each chunk independently.
- [x] Run `npm test` and `npm run check`; expect zero failures.
- [x] Commit `feat: define bounded process results`.

### Task 2: NodeProcessRunner lifecycle

**Files:**
- Create: `src/yisi/infrastructure/process/processTreeController.ts`
- Create: `src/yisi/infrastructure/process/nodeProcessRunner.ts`
- Test: `test/node-process-runner.test.js`

**Interfaces:**
- Consumes `ProcessRequest` and an injected `ProcessTreeController.terminate(child, graceMs)`.
- Produces one `ProcessResult` for exit, cancellation, timeout, or spawn failure.

- [x] Write failing integration tests using `process.execPath` for argument boundaries, cwd with spaces, stdout/stderr, non-zero exit, environment override, output truncation, AbortSignal, timeout, and nonexistent executable.
- [x] Run the focused test and confirm RED.
- [x] Implement exact-argv spawn, stdin close, bounded capture, timer/abort cleanup, and a single terminal-state resolver.
- [x] Run focused and full tests plus typecheck.
- [x] Commit `feat: add cancellable node process runner`.

### Task 3: Linux process-group termination

**Files:**
- Modify: `src/yisi/infrastructure/process/processTreeController.ts`
- Test: `test/process-tree-controller.test.js`

**Interfaces:**
- Produces `LinuxProcessTreeController` that signals only `-child.pid` with SIGTERM then optional SIGKILL.
- Produces `DirectChildProcessController` for non-Linux development and injected tests.

- [x] Write failing fake-host tests for negative process-group id, grace escalation, early exit, missing pid, and ESRCH normalization.
- [x] Run focused test and confirm RED.
- [x] Implement controllers without `pkill`, shell commands, or name matching.
- [x] Run focused/full tests and typecheck.
- [x] Commit `feat: terminate owned linux process groups`.

### Task 4: Validation evidence orchestration

**Files:**
- Replace: `src/yisi/validation/validationEngine.ts`
- Test: `test/validation-engine.test.js`

**Interfaces:**
- Consumes `ProcessRunner.run(request, signal)` and structured `CommandValidationStep` values.
- Produces `ValidationResult` with honest `passed`, terminal reason, per-step evidence, and bounded summaries.

- [x] Write failing tests for empty plan, sequential pass, non-zero stop, timeout/cancel stop, truncation metadata, and exact request forwarding.
- [x] Run focused test and confirm RED.
- [x] Implement orchestration with no command-string parsing.
- [x] Run full tests, typecheck, compile, and diff checks.
- [x] Commit `feat: produce command validation evidence`.

### Task 5: Documentation, review, and integration

**Files:**
- Modify: `README.md`
- Modify: `docs/12_ROADMAP_AND_DOD.md`
- Modify: `docs/16_LINUX_FIRST_PLATFORM_CONTRACT.md` only if implementation clarifies an existing rule

**Interfaces:**
- Records exact delivered behavior and Linux CI limitations without claiming the v0.2 Agent loop is complete.

- [x] Review branch diff for secret leakage, shell use, process-tree targeting, cleanup races, and dependency direction.
- [x] Run fresh `npm test`, `npm run check`, `npm run compile`, `git diff --check`, and `git status --short`.
- [x] Commit `docs: record process validation baseline`.
- [x] Fast-forward merge to `main`, rerun tests, delete the merged branch, then continue with Diagnostics/Agent loop.
