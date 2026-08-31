# Controlled Text File Creation — Design

## Goal

Add one narrowly scoped `create_text_file` Agent action that creates a new UTF-8 file without enabling overwrite, delete, rename, directory creation, or arbitrary binary writes.

## Contract

Input is an exact object containing a workspace-relative `path` and bounded `content`. The parent directory must already exist and resolve canonically inside the workspace. Implicitly sensitive targets are rejected.

The Node adapter writes and flushes a same-directory temporary file, then publishes it to the requested path with an exclusive filesystem operation. If the target exists or appears concurrently, creation fails without modifying it. Temporary artifacts are cleaned up best-effort. The result contains only path, SHA-256, and byte count.

The tool is `workspaceWrite`, so Plan denies, Manual asks through the Extension Host confirmation adapter, and Accept Edits/Auto follow the existing permission policy. Successful creation returns the same bounded post-mutation diagnostics evidence as replacement.

## Non-goals

- no parent directory creation;
- no overwrite or upsert behavior;
- no executable-mode selection;
- no binary/base64 content;
- no delete, move, rename, or shell execution;
- no Webview filesystem access.

## Verification

Tests cover success, existing-target race safety, boundary and sensitive paths, missing parent, byte limit, cancellation before publication, tool input validation, approval summary, diagnostics, and full regression verification.
