# Controlled Text Edit — Design

## Goal

Deliver the first workspace-writing vertical slice without broadening the Agent into arbitrary file replacement or shell execution:

`read_file -> propose unique text replacement -> permission decision -> optional host confirmation -> stale-safe atomic write -> structural result -> provider completion`

This belongs to the roadmap's file-editing and permission-engine milestone.

## Chosen scope

The first mutation tool is `replace_text`. Its exact input is:

- workspace-relative `path`;
- `expectedSha256` returned by `read_file`;
- non-empty `oldText` that must occur exactly once;
- `newText`, bounded independently from the source file.

It edits an existing, regular, UTF-8 text file only. It cannot create, delete, rename, chmod, edit implicitly sensitive paths, write outside the workspace, or follow a symlink outside the canonical workspace root.

The write adapter re-reads the file, verifies SHA-256 and unique-match preconditions, writes a same-directory temporary file, preserves the original mode, flushes, then renames. Failures never report success. Temporary artifacts are cleaned up best-effort.

## Permission and confirmation

The generic Agent loop may execute only registered `readOnly` and `workspaceWrite` tools. Every call still passes through `PermissionEngine`.

- Plan: deny before execution.
- Manual: require an explicit Extension Host confirmation for each proposed edit.
- Accept Edits / Auto: allow bounded workspace writes under the existing policy.
- Full Access: allow this non-destructive workspace write.

If confirmation is required but no confirmation port exists, the loop fails closed. The first VS Code adapter uses a modal warning with the target path and bounded replacement summary. It does not pass approval responsibility to Webview JavaScript.

## Failure and privacy behavior

Tool errors are bounded and returned structurally so the provider may recover. The result contains the path, before/after SHA-256, replacement count, and byte count—not whole file contents. Approval text is bounded. No key, credential, session JSON, or prompt history is written.

## Alternatives rejected for this slice

- Whole-file overwrite: creates unnecessarily large diffs and weak stale-write behavior.
- Unified-diff parsing: useful later, but substantially increases parser and ambiguity risk for the first write path.
- Webview-managed approval: violates the Extension Host service boundary.
- Temporary worktree per edit: excessive for one bounded write; session-level isolation remains a later capability.

## Verification

Tests cover hash emission, exact input parsing, success, stale hash, zero/multiple matches, sensitive paths, boundary/symlink behavior, atomic-write failure normalization, mode preservation where supported, permission confirmation/denial, cancellation, and Chat wiring. Full test, typecheck, compile, and diff checks run before merge.
