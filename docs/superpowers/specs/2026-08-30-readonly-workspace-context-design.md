# Read-only Workspace Context Design

## Scope

This is the first v0.2 Coding Agent MVP slice. It adds bounded `ReadFile`, `ListDirectory`, and literal `SearchText` capabilities for one local workspace without introducing file writes, shell execution, Remote-SSH logic, native dependencies, or an autonomous Agent loop.

## Architecture

The application layer owns a `WorkspaceContextService` and depends on a `FileSystemPort`. A Node/Linux-local adapter implements the port with standard `fs` APIs. Tool descriptions and permission metadata remain Yisi-owned domain data; no VS Code or Node types enter the domain layer.

```text
UI / future Agent tool call
        ↓
WorkspaceContextService
        ↓
FileSystemPort
        ↓
NodeWorkspaceFileSystem (local workspace adapter)
```

## Workspace boundary

- Inputs are workspace-relative paths; absolute paths and traversal are rejected.
- The configured root is canonicalized once.
- Existing targets are canonicalized with `realpath` before access.
- A symlink may be reported by directory listing, but reading or traversing a symlink that resolves outside the workspace is denied.
- Directory recursion never follows symlink directories and tracks canonical directories to prevent cycles.
- Paths are returned with `/` separators while filesystem access remains adapter-local.

## Resource and content limits

- File reads have a byte limit and reject binary/NUL content or invalid UTF-8.
- Directory listings have an entry limit.
- Search has file-count, result-count, per-file-size, and wall-clock limits plus `AbortSignal` cancellation.
- Search skips `.git`, dependency/build caches, symlinks, oversized files, and binary files.
- `.gitignore` content is not read implicitly in this slice, matching the repository agent rule. A later ignore-policy component may add explicit, tested handling without leaking ignored content into model context.

## Permission model

These operations are classified `read-only`, do not mutate the workspace, and are allowed in Plan mode. They still pass through the same tool metadata and future Permission Engine boundary; an LLM can never grant itself broader authority.

## Persistence and privacy

Raw file content is not automatically persisted merely because it was read or searched. Only context explicitly attached to a user turn may be sent to the selected model endpoint. Secrets, ignored files, and out-of-workspace targets are not implicitly collected.

## Verification

Node built-in tests cover traversal, absolute paths, symlink escape, UTF-8/binary/size limits, stable directory output, bounded search, cancellation, and case-sensitive filenames. Tests run on the current host; Linux-specific acceptance remains required before release.
