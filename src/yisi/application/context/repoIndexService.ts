import { FileSystemPort, WorkspaceDirectoryEntry } from '../../context/workspaceContext';
import { YisiTool } from '../../domain/tool';
import { isImplicitlySensitivePath } from '../../context/implicitSensitivePath';

export interface RepoIndexEntry {
  path: string;
  kind: 'file' | 'directory';
}

export interface RepoIndexResult {
  scannedFiles: number;
  directories: number;
  languages: Array<{ ext: string; files: number }>;
  topLevel: RepoIndexEntry[];
  truncated: boolean;
  durationMs: number;
  summary: string;
}

/** Directories skipped by default without consulting .gitignore (heavy/irrelevant). */
const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'target', 'out', 'bin', 'obj',
  'vendor', '.venv', 'venv', '__pycache__', '.next', '.cache', '.idea', '.vscode', 'coverage'
]);

/** Extensions treated as binary (never indexed as source). */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.gz', '.tar', '.jar', '.class', '.exe', '.dll', '.so', '.o', '.a', '.wasm', '.sqlite', '.db', '.bin'
]);

const LANG_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  cjs: 'JavaScript', py: 'Python', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++',
  rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', swift: 'Swift', php: 'PHP', rb: 'Ruby',
  sh: 'Shell', yml: 'YAML', yaml: 'YAML', json: 'JSON', md: 'Markdown', toml: 'TOML', html: 'HTML', css: 'CSS', sql: 'SQL'
};

export interface RepoIndexOptions {
  maxFiles?: number;
  maxDepth?: number;
  timeBudgetMs?: number;
}

const DEFAULT_OPTIONS: Required<RepoIndexOptions> = { maxFiles: 2_000, maxDepth: 12, timeBudgetMs: 1_500 };

export class RepoIndexService {
  constructor(private readonly fileSystem: FileSystemPort) {}

  async index(signal: AbortSignal, options: RepoIndexOptions = {}): Promise<RepoIndexResult> {
    const merged = { ...DEFAULT_OPTIONS, ...options };
    const startedAt = Date.now();
    const state = {
      files: 0,
      dirs: 0,
      extCounts: new Map<string, { ext: string; files: number }>(),
      topLevel: [] as RepoIndexEntry[],
      truncated: false
    };

    // Best-effort root .gitignore: patterns without a slash match any basename.
    const ignoreBasenames = await this.readRootGitignoreBasenames(signal);

    const walk = async (relDir: string, depth: number): Promise<void> => {
      if (signal.aborted) { state.truncated = true; return; }
      if (Date.now() - startedAt >= merged.timeBudgetMs) { state.truncated = true; return; }
      if (state.files >= merged.maxFiles) { state.truncated = true; return; }
      if (depth > merged.maxDepth) { state.truncated = true; return; }

      let entries: WorkspaceDirectoryEntry[];
      try {
        entries = await this.fileSystem.listDirectory(relDir, signal);
      } catch {
        state.truncated = true;
        return;
      }
      for (const entry of entries) {
        if (signal.aborted) return;
        if (isImplicitlySensitivePath(entry.path)) continue;
        if (entry.kind === 'symlink') continue; // avoid cycles / escaping the workspace
        if (ignoreBasenames.has(entry.name)) continue;

        if (entry.kind === 'directory') {
          if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
          state.dirs += 1;
          if (depth === 0) state.topLevel.push({ path: entry.path, kind: 'directory' });
          await walk(entry.path, depth + 1);
        } else if (entry.kind === 'file') {
          if (BINARY_EXTS.has(extOf(entry.name))) continue;
          if (state.files >= merged.maxFiles) { state.truncated = true; break; }
          state.files += 1;
          if (depth === 0) state.topLevel.push({ path: entry.path, kind: 'file' });
          const ext = extOf(entry.name).replace(/^\./, '');
          const lang = LANG_BY_EXT[ext];
          if (lang) {
            const bucket = state.extCounts.get(lang) ?? { ext: lang, files: 0 };
            state.extCounts.set(lang, { ext: lang, files: bucket.files + 1 });
          }
        }
      }
    };

    await walk('.', 0);
    const durationMs = Date.now() - startedAt;
    const languages = [...state.extCounts.values()].sort((a, b) => b.files - a.files);
    return {
      scannedFiles: state.files,
      directories: state.dirs,
      languages,
      topLevel: state.topLevel.slice(0, 100),
      truncated: state.truncated,
      durationMs,
      summary: summarize(state, merged)
    };
  }

  private async readRootGitignoreBasenames(signal: AbortSignal): Promise<Set<string>> {
    try {
      const content = await this.fileSystem.readFile('.gitignore', signal);
      const names = new Set<string>();
      for (const raw of content.text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        if (line.includes('/')) continue; // only handle basename patterns best-effort
        const basename = line.replace(/\/+$/, '').replace(/^\/+/, '');
        if (basename) names.add(basename);
      }
      return names;
    } catch {
      return new Set();
    }
  }
}

export function createRepoIndexTool(service: RepoIndexService): YisiTool {
  return {
    id: 'repo_index',
    description:
      'Build a bounded index of the active repository: counts of scanned source files and directories, language distribution, and top-level entries. Skips .git/node_modules/dist/build/vendor/hidden dirs and binary files, respects a root .gitignore (basename patterns), and honors file/depth/time budgets so a large repo never overwhelms the context. Use it to orient in a repo before reading files.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        maxFiles: { type: 'integer', minimum: 1, maximum: 50_000 },
        maxDepth: { type: 'integer', minimum: 1, maximum: 40 }
      },
      additionalProperties: false
    },
    execute: async (input, context) => {
      const options: RepoIndexOptions = {};
      if (typeof (input as Record<string, unknown>).maxFiles === 'number') options.maxFiles = (input as { maxFiles: number }).maxFiles;
      if (typeof (input as Record<string, unknown>).maxDepth === 'number') options.maxDepth = (input as { maxDepth: number }).maxDepth;
      return service.index(context.signal, options);
    }
  };
}

function extOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function summarize(state: {
  files: number; dirs: number; extCounts: Map<string, { ext: string; files: number }>;
  topLevel: RepoIndexEntry[]; truncated: boolean;
}, options: Required<RepoIndexOptions>): string {
  const languages = [...state.extCounts.values()].sort((a, b) => b.files - a.files);
  const langLine = languages.length > 0
    ? languages.slice(0, 10).map(item => `${item.ext} (${item.files})`).join(', ')
    : 'none detected';
  const lines = [
    `Indexed files: ${state.files} (dirs: ${state.dirs})`,
    `Languages: ${langLine}`
  ];
  if (state.truncated) lines.push(`Truncated (budget: ${options.maxFiles} files / ${options.maxDepth} depth).`);
  return lines.join('\n');
}
