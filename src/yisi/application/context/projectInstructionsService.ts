import { FileSystemPort } from '../../context/workspaceContext';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';
import {
  PROJECT_INSTRUCTION_FILE_NAMES,
  ProjectInstructionFile,
  boundProjectInstructions,
  hasUsableProjectInstructions
} from '../agent/projectInstructions';

/**
 * Looks up the workspace's project instruction file (AGENTS.md / CLAUDE.md / YISI.md).
 *
 * Reads go through the same workspace-bounded FileSystemPort the agent tools use,
 * so the lookup inherits the root boundary, the symlink protection and the
 * sensitive-path rules instead of re-implementing them. Only the execution root
 * is searched — a session running in an isolated worktree reads that worktree's
 * copy, which is the checkout the agent is actually editing.
 *
 * Failure is never fatal. This runs before every agent run, so a missing file, a
 * directory in its place, an oversized file or an unreadable one must all resolve
 * to "no instructions" rather than failing the run; only cancellation propagates.
 */
export class ProjectInstructionsService {
  constructor(
    private readonly fileSystem: Pick<FileSystemPort, 'readFile'>,
    private readonly candidates: readonly string[] = PROJECT_INSTRUCTION_FILE_NAMES
  ) {}

  async load(signal?: AbortSignal): Promise<ProjectInstructionFile | undefined> {
    signal?.throwIfAborted();
    for (const candidate of this.candidates) {
      // Defence in depth: the names are fixed, but the rule is cheap and keeps a
      // future configurable candidate list from reading a credential file.
      if (isImplicitlySensitivePath(candidate)) continue;
      let text: string;
      let path: string;
      try {
        const file = await this.fileSystem.readFile(candidate, signal);
        text = boundProjectInstructions(file.text);
        path = file.path;
      } catch (error) {
        // Cancellation is the one failure the caller must see.
        signal?.throwIfAborted();
        continue;
      }
      const file: ProjectInstructionFile = { path, text };
      if (!hasUsableProjectInstructions(file)) continue;
      return file;
    }
    return undefined;
  }
}
