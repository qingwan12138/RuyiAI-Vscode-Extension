// Workspace project-profile service + agent tool factory.
//
// Scans the workspace root plus a bounded set of conventional source/test
// directories, decodes well-known build manifests, and runs the pure detector
// (projectProfileDetector). The result is a read-only, evidence-carrying
// profile that helps the agent pick the right test framework and validation
// commands (contract G4: language adaptation for unit-test generation).

import { FileSystemPort } from '../../context/workspaceContext';
import { YisiTool } from '../../domain/tool';
import {
  detectProjectProfile,
  ProjectProfile,
  renderProjectProfileSummary,
  ScannedFile
} from './projectProfileDetector';

/** Candidate directories probed one level below the workspace root. */
const PROBE_DIRECTORIES: readonly string[] = [
  'src', 'include', 'lib', 'app', 'tests', 'test', 'spec', '__tests__'
];

const MAX_PROBE_DIRECTORIES = 8;
const MAX_PROFILE_READS = 32;

export interface ProjectProfileInspection {
  profile: ProjectProfile;
  summary: string;
}

export class ProjectProfileService {
  constructor(private readonly fileSystem: FileSystemPort) {}

  async inspect(signal?: AbortSignal): Promise<ProjectProfileInspection> {
    const files: ScannedFile[] = [];
    const contents: Record<string, string> = {};

    let rootEntries;
    try {
      rootEntries = await this.fileSystem.listDirectory('.', signal);
    } catch (error) {
      throw new Error('Project inspection requires a readable workspace.');
    }

    const directories = rootEntries
      .filter(entry => entry.kind === 'directory' && PROBE_DIRECTORIES.includes(entry.name))
      .slice(0, MAX_PROBE_DIRECTORIES);

    const candidates = [...rootEntries];
    for (const directory of directories) {
      try {
        const entries = await this.fileSystem.listDirectory(directory.name, signal);
        for (const entry of entries) {
          candidates.push({ ...entry, path: `${directory.name}/${entry.name}` });
        }
      } catch {
        // An unreadable probe directory only narrows the scan; it never fails it.
      }
    }

    for (const entry of candidates) {
      if (entry.kind !== 'file' && entry.kind !== 'symlink') continue;
      files.push({ path: entry.path, name: entry.name });
    }

    // Decode manifests first (bounded read count); everything else only counts
    // as a language/filename signal.
    const reads = files.slice(0, MAX_PROFILE_READS);
    for (const file of reads) {
      signal?.throwIfAborted();
      try {
        const content = await this.fileSystem.readFile(file.path, signal);
        contents[file.path] = content.text;
      } catch {
        // Unreadable/binary manifest files are skipped; detection degrades.
      }
    }

    const profile = detectProjectProfile(files, contents);
    return { profile, summary: renderProjectProfileSummary(profile) };
  }
}

export function createInspectProjectTool(service: ProjectProfileService): YisiTool {
  return {
    id: 'inspect_project',
    description:
      'Inspect the active workspace for its build system and test framework before generating unit tests '
      + 'or choosing a build/test command. Returns detected languages, build manifests and test frameworks '
      + 'with evidence files, plus suggested commands. Read-only.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => {
      const inspection = await service.inspect(context.signal);
      return {
        profile: inspection.profile,
        summary: inspection.summary
      };
    }
  };
}
