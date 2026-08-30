# Read-only Workspace Context Implementation Plan

**Goal:** Deliver bounded, cancellable, workspace-confined Read/List/Search tools as the first v0.2 foundation.

**Constraints:** TypeScript/Node standard library only; Linux local-first; no shell; no file mutation; no implicit `.gitignore` content read; no Remote-SSH behavior.

### Task 1: Domain contracts and safe local adapter

- Create `src/yisi/context/workspaceContext.ts` with port/result types and limits.
- Create `src/yisi/infrastructure/context/nodeWorkspaceFileSystem.ts`.
- Test traversal, absolute paths, symlink escape, binary/UTF-8/size checks, listing, search limits, and cancellation.
- Verify with `npm test` and `npm run check`.

### Task 2: Application context service and tool metadata

- Create `WorkspaceContextService` that validates user/tool inputs and normalizes results.
- Define owned tool descriptors for `read_file`, `list_directory`, and `search_text`, all with `read-only` risk and cancellation support.
- Add unit tests that prove no privileged implementation leaks into domain/application code.

### Task 3: Permission Engine read-only baseline

- Replace the placeholder permission engine with typed decisions.
- Prove Plan and Manual allow these read-only tools while rejecting undeclared, mutating, or inconsistent metadata.
- Keep all execution decisions outside the Webview and LLM provider.

### Task 4: Host/UI context attachment

- Connect Add Context to a workspace-scoped file picker.
- Read through `WorkspaceContextService`, show an attachment chip, and include only explicitly attached content in the next provider request.
- Persist only the user-visible attachment reference needed for session restoration; never expose secrets or filesystem authority to Webview.

### Task 5: Verification and integration

- Run tests, typecheck, compile, diff checks, and local review.
- Update roadmap/UI/storage documentation with exact limitations.
- Merge the verified feature branch into `main`, rerun tests, then continue with ProcessRunner/Diagnostics.
